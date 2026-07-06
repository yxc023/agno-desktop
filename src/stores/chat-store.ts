/**
 * Chat store: 当前 session 的消息列表 + 当前选中的 agent
 *
 * 设计:
 * - messagesBySession 按 sessionId 索引，存 top-level ChatMessage[]；
 *   每个 ChatMessage 可以有 subMessages[]（team / multi-agent 场景下用于展示子 agent 的独立产出）。
 * - 一个 ChatRunner 实例对应"一次 run"。
 * - 任何对 sub-message 的更新通过 `updateAnyMessage` 递归写入。
 */

import { create } from "zustand";
import { ChatRunner } from "@/lib/chat-runner";
import type { ChatMessage, MessagePart, ToolCallPart } from "@/lib/message-types";
import { useInstancesStore } from "./instances-store";
import { useSessionsStore } from "./sessions-store";
import { generateId } from "@/lib/utils";
import type { AgRunResponse } from "@/lib/agno-types";

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/* ------------------------------------------------------------------ */
/* 树形操作 utils                                                      */
/* ------------------------------------------------------------------ */

/** 在树中按 id 查找 message（任意深度）。 */
function findInTree(
  messages: ChatMessage[],
  id: string
): ChatMessage | null {
  for (const m of messages) {
    if (m.id === id) return m;
    if (m.subMessages && m.subMessages.length > 0) {
      const r = findInTree(m.subMessages, id);
      if (r) return r;
    }
  }
  return null;
}

/** 收集所有 sub-message（任意深度），可用于 debug / fallback 列表展示。当前未直接使用，作为 helper 保留。 */
// function collectSubMessages(messages: ChatMessage[]): ChatMessage[] {
//   const out: ChatMessage[] = [];
//   const walk = (ms: ChatMessage[]) => {
//     for (const m of ms) {
//       if (m.subMessages) {
//         for (const s of m.subMessages) {
//           out.push(s);
//           walk([s]); // 嵌套
//         }
//       }
//     }
//   };
//   walk(messages);
//   return out;
// }

/** 把 ts 归一为毫秒。AGNO 给出的是秒（10 位左右），也可能直接给毫秒。 */
function toMs(ts: number | undefined): number {
  if (!ts) return 0;
  return ts > 1e12 ? ts : ts * 1000;
}

/** 替换树中的某条 message（返回新数组）。 */
function replaceInTree(
  messages: ChatMessage[],
  id: string,
  updater: (m: ChatMessage) => ChatMessage
): ChatMessage[] {
  return messages.map((m) => {
    if (m.id === id) {
      const next = updater(m);
      // Force a fresh object reference when the updater returns the same
      // instance it received. ChatRunner mutates target.parts in place and
      // then passes the same target via onMessageUpdate → updateAnyMessage;
      // selectors subscribed to a specific sub-message (e.g.
      // SubAgentSidePanel via useChatStore(s => findInTree(...))) would
      // otherwise see Object.is(prev, next) === true and skip re-render,
      // freezing the streaming UI even though the store has changed.
      return next === m ? { ...m } : next;
    }
    if (m.subMessages && m.subMessages.length > 0) {
      return {
        ...m,
        subMessages: replaceInTree(m.subMessages, id, updater),
      };
    }
    return m;
  });
}

/** 在 parentId 下追加 sub message；如果 parentId 已经是另一条 sub 的子则递归下降。 */
function appendSubInTree(
  messages: ChatMessage[],
  parentId: string,
  sub: ChatMessage
): ChatMessage[] {
  return messages.map((m) => {
    if (m.id === parentId) {
      return { ...m, subMessages: [...(m.subMessages ?? []), sub] };
    }
    if (m.subMessages && m.subMessages.length > 0) {
      return {
        ...m,
        subMessages: appendSubInTree(m.subMessages, parentId, sub),
      };
    }
    return m;
  });
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface ChatState {
  /** 当前 session 的所有 top-level 消息 */
  messagesBySession: Record<string, ChatMessage[]>;
  /** 当前选中的 agent/team/workflow id */
  selectedAgentId: string | null;
  selectedType: "agent" | "team" | "workflow";
  /** 当前的 ChatRunner */
  runner: ChatRunner | null;
  /** 加载状态 */
  loadingHistory: boolean;

  setSelectedAgent: (id: string | null, type?: "agent" | "team" | "workflow") => void;
  setMessages: (sessionId: string, messages: ChatMessage[]) => void;
  appendMessage: (sessionId: string, message: ChatMessage) => void;
  updateMessage: (
    sessionId: string,
    messageId: string,
    updater: (m: ChatMessage) => ChatMessage
  ) => void;
  /** 任意深度（top 或 sub）按 id 更新，沿用 React 不可变更新模式。 */
  updateAnyMessage: (
    sessionId: string,
    messageId: string,
    updater: (m: ChatMessage) => ChatMessage
  ) => void;
  /** 在指定 parentId 下追加一条 sub message。 */
  appendSubMessage: (
    sessionId: string,
    parentId: string,
    sub: ChatMessage
  ) => void;
  clearMessages: (sessionId: string) => void;
  loadHistory: (sessionId: string) => Promise<void>;

  sendMessage: (params: {
    text: string;
    files?: File[];
    sessionId?: string | null;
    agentId?: string;
  }) => Promise<void>;
  cancelRun: () => Promise<void>;
  continueRun: (toolResults: Array<{ tool_call_id: string; content: string }>) => Promise<void>;
  newSession: (agentId?: string) => string;
}

/* ------------------------------------------------------------------ */
/* Reconstruct sub-messages from a single AGNO run                    */
/* ------------------------------------------------------------------ */

/**
 * 把一个 AgRunResponse（含 messages[]）转成 ChatMessage[]，不做跨 message 的合并。
 * - 忽略 role==="user" 的消息（member agent 的内部 delegation 提示对用户没意义；
 *   但保留最外层 user 的可见 user message —— 这由 chat_history 提供，不是这里）。
 * - role==="tool" 合并到最近一条 assistant 的 tool_call 上。
 */
function runToChatMessages(
  run: AgRunResponse,
  opts: { includeUser?: boolean } = {}
): ChatMessage[] {
  const includeUser = opts.includeUser ?? false;
  const out: ChatMessage[] = [];
  let currentAssistant: ChatMessage | null = null;

  const flushAssistant = () => {
    if (currentAssistant && currentAssistant.parts.length > 0) {
      out.push(currentAssistant);
    }
    currentAssistant = null;
  };

  const messages = run.messages ?? [];

  for (const m of messages) {
    const role = (m.role as string) || "assistant";

    if (role === "user") {
      if (includeUser) {
        flushAssistant();
        const content = typeof m.content === "string" ? m.content : "";
        out.push({
          id: m.id ?? generateId(),
          role: "user",
          parts: [{ type: "text", text: content }],
          status: "completed",
          createdAt:
            typeof m.created_at === "number"
              ? m.created_at > 1e12
                ? m.created_at
                : m.created_at * 1000
              : Date.now(),
          runId: run.run_id,
        });
      } else {
        flushAssistant();
      }
      continue;
    }

    if (role === "tool" && currentAssistant && m.tool_call_id) {
      const lastTool = [...currentAssistant.parts]
        .reverse()
        .find(
          (p) => p.type === "tool_call" && p.toolCallId === m.tool_call_id
        );
      if (lastTool && lastTool.type === "tool_call") {
        const content = m.content;
        const resultStr =
          typeof content === "string" ? content : JSON.stringify(content);
        lastTool.result =
          typeof resultStr === "string" ? safeParse(resultStr) : resultStr;
      }
      continue;
    }

    if (role !== "assistant") {
      continue;
    }

    const parts: MessagePart[] = [];

    if (m.reasoning_content) {
      parts.push({
        type: "reasoning",
        text: m.reasoning_content,
        steps: m.reasoning_steps ?? undefined,
      });
    }

    for (const tc of m.tool_calls ?? []) {
      const t = tc as any;
      const id = t.tool_call_id ?? t.id ?? generateId();
      const name = t.tool_name ?? t.function?.name ?? t.name ?? "tool";
      let args: any = {};
      if (t.tool_args !== undefined && t.tool_args !== null) {
        args = t.tool_args;
      } else if (t.function?.arguments) {
        try {
          args = JSON.parse(t.function.arguments);
        } catch {
          args = {};
        }
      } else if (t.arguments) {
        args =
          typeof t.arguments === "string"
            ? safeParse(t.arguments)
            : t.arguments;
      }
      const result = t.result ?? null;
      const metrics = t.metrics;
      parts.push({
        type: "tool_call",
        toolCallId: id,
        toolName: name,
        args,
        result: typeof result === "string" ? safeParse(result) : result,
        status: t.tool_call_error ? "error" : "completed",
        metrics,
        startedAt: 0,
        endedAt: 0,
        durationMs:
          metrics?.duration != null ? Math.round(metrics.duration * 1000) : undefined,
      });
    }

    const content = m.content;
    if (typeof content === "string" && content.trim()) {
      parts.push({ type: "text", text: content });
    } else if (typeof content === "object" && content !== null) {
      const text = (content as any).text ?? "";
      if (text) parts.push({ type: "text", text });
    }

    if (parts.length === 0) {
      continue;
    }

    currentAssistant = {
      id: m.id ?? generateId(),
      role: "assistant",
      parts,
      status: "completed",
      createdAt:
        typeof m.created_at === "number"
          ? m.created_at > 1e12
            ? m.created_at
            : m.created_at * 1000
          : Date.now(),
      agentId: run.agent_id ?? undefined,
      teamId: run.team_id ?? undefined,
      runId: run.run_id,
      displayName:
        (run as any).extra_data?.agent_name ??
        (run as any).extra_data?.team_name ??
        run.agent_id ??
        run.team_id,
      metrics: m.metrics
        ? {
            input_tokens: m.metrics.input_tokens,
            output_tokens: m.metrics.output_tokens,
            total_tokens: m.metrics.total_tokens,
            duration: m.metrics.duration
              ? m.metrics.duration * 1000
              : undefined,
          }
        : undefined,
    };
  }

  flushAssistant();
  return out;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messagesBySession: {},
  selectedAgentId: null,
  selectedType: "agent",
  runner: null,
  loadingHistory: false,

  setSelectedAgent: (id, type = "agent") =>
    set({ selectedAgentId: id, selectedType: type }),

  setMessages: (sessionId, messages) =>
    set((s) => ({
      messagesBySession: { ...s.messagesBySession, [sessionId]: messages },
    })),

  appendMessage: (sessionId, message) =>
    set((s) => {
      const list = s.messagesBySession[sessionId] ?? [];
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: [...list, message],
        },
      };
    }),

  updateMessage: (sessionId, messageId, updater) =>
    set((s) => {
      const list = s.messagesBySession[sessionId] ?? [];
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: list.map((m) => (m.id === messageId ? updater(m) : m)),
        },
      };
    }),

  updateAnyMessage: (sessionId, messageId, updater) =>
    set((s) => {
      const list = s.messagesBySession[sessionId] ?? [];
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: replaceInTree(list, messageId, updater),
        },
      };
    }),

  appendSubMessage: (sessionId, parentId, sub) =>
    set((s) => {
      const list = s.messagesBySession[sessionId] ?? [];
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: appendSubInTree(list, parentId, sub),
        },
      };
    }),

  clearMessages: (sessionId) =>
    set((s) => {
      const { [sessionId]: _, ...rest } = s.messagesBySession;
      return { messagesBySession: rest };
    }),

  loadHistory: async (sessionId) => {
    const activeId = useInstancesStore.getState().activeInstanceId;
    if (!activeId) return;
    const client = useInstancesStore.getState().getClient(activeId);
    if (!client) return;
    set({ loadingHistory: true });
    try {
      // 并行拉取 session 详情和 runs
      const [detail, runs] = await Promise.all([
        client.getSession(sessionId),
        client
          .getSessionRuns(sessionId)
          .catch(() => [] as Awaited<ReturnType<typeof client.getSessionRuns>>),
      ]);
      const history = detail.chat_history ?? [];

      // 索引：run_id -> run 对象（用于拿 reasoning_content 等）
      const runById = new Map<string, AgRunResponse>();
      for (const r of runs) {
        if (r.run_id) runById.set(r.run_id, r);
      }

      // 跟踪每个 message_id 对应的 run_id（如果有）
      const runIdByMessageId = new Map<string, string>();
      for (const r of runs) {
        for (const m of r.messages ?? []) {
          if (m?.id) runIdByMessageId.set(m.id, r.run_id);
        }
      }

      // 按 parent_run_id 索引 child runs（sub-agents）
      const childRunsByParentRunId = new Map<string, AgRunResponse[]>();
      for (const r of runs) {
        if (r.parent_run_id) {
          const arr = childRunsByParentRunId.get(r.parent_run_id) ?? [];
          arr.push(r);
          childRunsByParentRunId.set(r.parent_run_id, arr);
        }
      }

      const messages: ChatMessage[] = [];
      let currentAssistant: ChatMessage | null = null;
      const ASSISTANT_MERGE_GAP = 10 * 60 * 1000; // 10 分钟内的连续 assistant 合并

      const flushAssistant = () => {
        if (currentAssistant) {
          messages.push(currentAssistant);
          currentAssistant = null;
        }
      };

      for (const m of history) {
        const role = (m.role as ChatMessage["role"]) ?? "assistant";
        const parts: MessagePart[] = [];

        // 1) reasoning 内容
        const runId = m.id ? runIdByMessageId.get(m.id) : undefined;
        const run = runId ? runById.get(runId) : undefined;
        if (m.reasoning_content) {
          parts.push({
            type: "reasoning",
            text: m.reasoning_content,
            steps: m.reasoning_steps ?? undefined,
          });
        } else if (run?.reasoning_content) {
          parts.push({
            type: "reasoning",
            text: run.reasoning_content,
            steps: run.reasoning_steps ?? undefined,
          });
        }

        // 2) tool_calls
        const toolCalls = m.tool_calls ?? [];
        for (const tc of toolCalls) {
          const t = tc as any;
          const id = t.tool_call_id ?? t.id ?? generateId();
          const name =
            t.tool_name ?? t.function?.name ?? t.name ?? "tool";
          let args: any = {};
          if (t.tool_args !== undefined && t.tool_args !== null) {
            args = t.tool_args;
          } else if (t.function?.arguments) {
            try {
              args = JSON.parse(t.function.arguments);
            } catch {
              args = {};
            }
          } else if (t.arguments) {
            args =
              typeof t.arguments === "string"
                ? safeParse(t.arguments)
                : t.arguments;
          }
          const result = t.result ?? null;
          const metrics = t.metrics;
          parts.push({
            type: "tool_call",
            toolCallId: id,
            toolName: name,
            args,
            result: typeof result === "string" ? safeParse(result) : result,
            status: t.tool_call_error ? "error" : "completed",
            metrics,
            startedAt: 0,
            endedAt: 0,
            durationMs:
              metrics?.duration != null
                ? Math.round(metrics.duration * 1000)
                : undefined,
          });
        }

        // 3) text content
        const content = m.content;
        if (typeof content === "string" && content.trim()) {
          parts.push({ type: "text", text: content });
        } else if (typeof content === "object" && content !== null) {
          const text = (content as any).text ?? JSON.stringify(content);
          if (text) parts.push({ type: "text", text });
        }

        const createdAt =
          typeof m.created_at === "number"
            ? m.created_at > 1e12
              ? m.created_at
              : m.created_at * 1000
            : Date.now();

        const metricsSummary = m.metrics
          ? {
              input_tokens: m.metrics.input_tokens,
              output_tokens: m.metrics.output_tokens,
              total_tokens: m.metrics.total_tokens,
              duration: m.metrics.duration
                ? m.metrics.duration * 1000
                : undefined,
            }
          : run?.metrics
          ? {
              input_tokens: run.metrics.input_tokens,
              output_tokens: run.metrics.output_tokens,
              total_tokens: run.metrics.total_tokens,
              duration: run.metrics.duration
                ? run.metrics.duration * 1000
                : undefined,
            }
          : undefined;

        // role === "tool" 的消息：合并到上一个 assistant 的 tool_call 里
        if ((role as string) === "tool" && m.tool_call_id && currentAssistant) {
          const lastTool = [...currentAssistant.parts]
            .reverse()
            .find((p) => p.type === "tool_call" && p.toolCallId === m.tool_call_id) as
              | (typeof currentAssistant.parts)[number]
              | undefined;
          if (lastTool && lastTool.type === "tool_call") {
            const content = m.content;
            const resultStr =
              typeof content === "string" ? content : JSON.stringify(content);
            lastTool.result =
              typeof resultStr === "string"
                ? safeParse(resultStr)
                : resultStr;
            if (m.metrics) {
              lastTool.metrics = {
                duration: m.metrics.duration
                  ? m.metrics.duration * 1000
                  : undefined,
                ...m.metrics,
              };
            }
            continue; // 不创建新 message
          }
        }

        if (role === "user" || role === "system") {
          // 新的 user/system 消息先把上一个 assistant flush
          flushAssistant();
          if (parts.length === 0 && typeof content === "string") {
            parts.push({ type: "text", text: content });
          }
          messages.push({
            id: m.id ?? generateId(),
            role,
            parts,
            status: "completed",
            createdAt,
            agentId: detail.agent_id,
            sessionId,
          });
          continue;
        }

        // role === "assistant"
        if (
          currentAssistant &&
          createdAt - currentAssistant.createdAt < ASSISTANT_MERGE_GAP
        ) {
          // 合并到上一个 assistant message
          currentAssistant.parts.push(...parts);
          // 合并 metrics（累加 token，保留最晚时间）
          if (metricsSummary?.total_tokens) {
            currentAssistant.metrics = {
              input_tokens:
                (currentAssistant.metrics?.input_tokens ?? 0) +
                (metricsSummary.input_tokens ?? 0),
              output_tokens:
                (currentAssistant.metrics?.output_tokens ?? 0) +
                (metricsSummary.output_tokens ?? 0),
              total_tokens:
                (currentAssistant.metrics?.total_tokens ?? 0) +
                (metricsSummary.total_tokens ?? 0),
              duration: Math.max(
                currentAssistant.metrics?.duration ?? 0,
                metricsSummary.duration ?? 0
              ),
            };
          }
          currentAssistant.createdAt = createdAt; // 用最晚时间
        } else {
          // 新的 assistant message
          flushAssistant();
          if (parts.length === 0) continue; // 跳过空 assistant
          currentAssistant = {
            id: m.id ?? generateId(),
            role: "assistant",
            parts,
            status: "completed",
            createdAt,
            agentId: detail.agent_id,
            sessionId,
            runId,
            metrics: metricsSummary,
          };
        }
      }
      flushAssistant();

      // —— 注入 sub-agents ——
      //
      // 数据源：
      //   - runs[0].events[] 持久化了所有 streaming 事件（含 sub-agent 的；
      //     每个事件有 agent_id/agent_name/parent_run_id 用于区分）。
      //     这是 AGNO `WorkspaceContextProvider`、`Team` 嵌套等场景的
      //     唯一可靠数据源——`runs[]` 顶层 JSONB 不会为子 agent 单独建 run，
      //     但 events[] 把所有 nesting 都打平+打上 tag 了。
      //   - 我们不用 `/traces/{id}`，避免双数据源一致性成本。
      //
      // 算法：扫描 events[] 流，找到外层 agent 的 ToolCallStarted(T) / ToolCallCompleted(T)
      // 围成的"作用域"；作用域内所有 agent_name ≠ outer 的 event 聚成 sub-agents，
      // 每个 sub-agent run_id 一条 ChatMessage，通过外层 tool_call_id 挂到
      // chat_history 里的 assistant message（按 tool_calls[].id 对齐）。
      //
      // 每个 root message 的 sub-messages。每个 anchor 记录是哪个 outer tool_call_id
      // 触发的这个 sub-agent —— marker 注入时按这个 id 找到对应的 tool_call part，
      // 把 marker 紧跟在它后面，让用户视觉上看到"这个 chip 是被这条 tool call 唤起的"。
      // 对于 Team mode / fallback 等拿不到 outer tool_call_id 的情况，记 null 走末尾兜底。
      const childMessagesByParent = new Map<
        string,
        Array<{ subMessage: ChatMessage; outerToolCallId: string | null }>
      >();
      const attachedRunIds = new Set<string>();

      /** 把 sub-agent run 的 event 数组转成一条 ChatMessage。 */
      const buildSubFromEvents = (
        subRunId: string,
        subEvents: any[]
      ): ChatMessage => {
        const parts: MessagePart[] = [];
        let reasoningText = "";
        let agentName = "";
        let agentId = "";
        let createdAt = 0;
        const perTc = new Map<
          string,
          { idx: number; startedAt: number; tc: any }
        >();

        for (const ev of subEvents) {
          if (!agentName && ev.agent_name) agentName = ev.agent_name;
          if (!agentId && ev.agent_id) agentId = ev.agent_id;
          const evTs =
            typeof ev.created_at === "number"
              ? ev.created_at > 1e12
                ? ev.created_at
                : ev.created_at * 1000
              : 0;
          if (evTs) {
            if (!createdAt) createdAt = evTs;
          }

          // reasoning
          const r =
            typeof ev.reasoning_content === "string"
              ? ev.reasoning_content
              : typeof ev.reasoning === "string"
              ? ev.reasoning
              : null;
          if (r) reasoningText += r;
          // reason_steps (AGNO emits via ReasoningStep event)
          // (not handled — events schema missing; reasoning content only)

          const evName: string = ev.event ?? "";
          const toolObj: any = ev.tool ?? null;

          if (
            (evName === "ToolCallStarted" || evName === "ToolCallStartedDelta") &&
            toolObj
          ) {
            const tcid =
              toolObj.tool_call_id ??
              ev.tool_call_id ??
              `tc-${Date.now()}-${Math.random()}`;
            const toolName = toolObj.tool_name ?? "tool";
            const args = toolObj.tool_args ?? {};
            const existing = perTc.get(tcid);
            if (existing != null) {
              // 同一个 tool_call_id 重复到达 Started（AGNO 重连/重发场景）——
              // 不再 push 新 part，而是把最新 tool_args 合并到第一份 part 上，
              // 并把 perTc 指向最新的位置。
              const oldPart = parts[existing.idx] as ToolCallPart;
              parts[existing.idx] = {
                ...oldPart,
                toolName,
                args: args ?? oldPart.args,
              };
              existing.tc = toolObj;
            } else {
              const part: ToolCallPart = {
                type: "tool_call",
                toolCallId: tcid,
                toolName,
                args,
                status: "calling",
                startedAt: evTs || Date.now(),
              };
              parts.push(part);
              perTc.set(tcid, {
                idx: parts.length - 1,
                startedAt: part.startedAt,
                tc: toolObj,
              });
            }
          } else if (
            (evName === "ToolCallCompleted" ||
              evName === "ToolCallResult") &&
            toolObj
          ) {
            const tcid =
              toolObj.tool_call_id ??
              ev.tool_call_id ??
              "";
            let resultRaw = toolObj.result ?? null;
            let resultValue: any = resultRaw;
            if (typeof resultValue === "string") {
              try {
                resultValue = JSON.parse(resultValue);
              } catch {
                // keep string
              }
            }
            const tracked = perTc.get(tcid);
            if (tracked != null) {
              const metrics = toolObj.metrics;
              const errText = toolObj.tool_call_error
                ? String(resultValue ?? "tool error")
                : undefined;
              const endedAt = evTs || Date.now();
              const durationMs =
                metrics?.duration != null
                  ? Math.round(metrics.duration * 1000)
                  : endedAt - tracked.startedAt;
              // 同一个 tool_call_id 可能存在多处重复 part（重发的 Started 事件遗留、
              // 或者 retry 场景）。更新**所有**匹配的位置，并把 perTc 指向最后一个。
              let lastIdx = tracked.idx;
              for (let i = 0; i < parts.length; i++) {
                const p = parts[i];
                if (p.type === "tool_call" && p.toolCallId === tcid) {
                  parts[i] = {
                    ...p,
                    result: resultValue,
                    status: toolObj.tool_call_error ? "error" : "completed",
                    error: errText,
                    metrics,
                    endedAt,
                    durationMs:
                      // 时长按**该 part 的**startedAt 与 endedAt 计算
                      // （perTc 里存的是首次 Started 时间，对重发新建的 part 不准）。
                      metrics?.duration != null
                        ? Math.round(metrics.duration * 1000)
                        : endedAt - p.startedAt,
                  };
                  lastIdx = i;
                }
              }
              perTc.set(tcid, { ...tracked, idx: lastIdx });
            } else {
              // 没看到 Started，直接 Completed——也 push 一条 completed 的
              const part: ToolCallPart = {
                type: "tool_call",
                toolCallId: tcid || `tc-${Date.now()}-${Math.random()}`,
                toolName: toolObj.tool_name ?? "tool",
                args: toolObj.tool_args ?? {},
                result: resultValue,
                status: toolObj.tool_call_error ? "error" : "completed",
                startedAt: evTs || Date.now(),
                endedAt: evTs || Date.now(),
              };
              parts.push(part);
            }
            // 注意：标记 attachedRunIds 不在这里做——见下方 attach() 处。
            // 这里之前是 `subRunId + ":" + tcid`（复合 key），与 Stage B/C 的 bare run_id
            // lookup (line ~959 / ~971) 形状不一致，导致 dedup 失效，
            // 同一个 sub-agent 会在 Stage A 和 Stage B/C 各附加一次。
          }

          // sub-agent 最终文字输出（RunCompleted.content）
          if (evName === "RunCompleted") {
            const text =
              typeof ev.content === "string"
                ? ev.content
                : typeof ev.content === "object" && ev.content
                ? (ev.content as any).text ?? ""
                : "";
            if (text && text.trim()) {
              parts.push({ type: "text", text });
            }
          }
        }

        if (reasoningText.trim()) {
          parts.unshift({ type: "reasoning", text: reasoningText });
        }

        const durationMs =
          createdAt && subEvents[subEvents.length - 1]?.created_at
            ? (() => {
                const lastTs = subEvents[subEvents.length - 1].created_at;
                const last = lastTs > 1e12 ? lastTs : lastTs * 1000;
                return last - createdAt;
              })()
            : undefined;

        return {
          id: generateId(),
          role: "assistant",
          parts,
          status: "completed",
          createdAt: createdAt || Date.now(),
          runId: subRunId,
          agentId: agentId || undefined,
          teamId: undefined,
          displayName: agentName || agentId || "sub-agent",
          metrics: durationMs ? { duration: durationMs } : undefined,
        };
      };

      /**
       * 从 runs[].events[] 中提取 sub-agent ChatMessage，按外层 tool_call_id 分组。
       *
       * 返回: Map<outer tool_call_id, ChatMessage[]>
       * - 一条 outer tool_call 可能含 1..N 个 sub-agent（Team 模式会出现）
       * - 单 agent / 调普通工具时返回空 map
       */
      const extractSubAgents = (
        events: any[],
        outerAgentName: string
      ): Map<string, ChatMessage[]> => {
        const out = new Map<string, ChatMessage[]>();
        let currentOuterTcId: string | null = null;
        // scope 内累积的 sub-agent event，按 sub-run-id 分桶
        const scopeEventsBySubId = new Map<string, any[]>();

        const flushScope = () => {
          if (!currentOuterTcId) return;
          const subs: ChatMessage[] = [];
          for (const [subRunId, subEvents] of scopeEventsBySubId) {
            if (!subRunId || subEvents.length === 0) continue;
            subs.push(buildSubFromEvents(subRunId, subEvents));
          }
          if (subs.length > 0) {
            const existing = out.get(currentOuterTcId) ?? [];
            const seen = new Set(existing.map((m) => m.runId));
            for (const s of subs) {
              if (s.runId && !seen.has(s.runId)) {
                existing.push(s);
                seen.add(s.runId);
              }
            }
            out.set(currentOuterTcId, existing);
          }
        };

        for (const ev of events ?? []) {
          const evName: string = ev?.event ?? "";
          const isOuter = ev?.agent_name === outerAgentName;
          if (isOuter) {
            if (evName === "ToolCallStarted") {
              // 进入新 scope：先把上个 scope 收尾
              flushScope();
              currentOuterTcId =
                ev.tool?.tool_call_id ?? ev.tool_call_id ?? null;
              scopeEventsBySubId.clear();
            } else if (evName === "ToolCallCompleted") {
              // 收尾当前 scope
              flushScope();
              currentOuterTcId = null;
              scopeEventsBySubId.clear();
            }
          } else {
            // Sub-agent event：仅在 outer scope 内计入
            const subRunId = ev?.run_id ?? null;
            if (currentOuterTcId && subRunId && ev?.agent_name) {
              if (!scopeEventsBySubId.has(subRunId)) {
                scopeEventsBySubId.set(subRunId, []);
              }
              scopeEventsBySubId.get(subRunId)!.push(ev);
            }
          }
        }
        // 兜底：文件末尾还可能开着一个 scope
        flushScope();
        return out;
      };

      // 阶段 A：从 events[] 提取——这是 AGNO 当前最可靠的数据源
      for (const run of runs) {
        const events = (run as any).events;
        if (!Array.isArray(events) || events.length === 0) continue;
        const outerAgentName =
          (run as any).agent_name ??
          (events.find((e: any) => e?.agent_name)?.agent_name as string) ??
          "";
        if (!outerAgentName) continue;
        const subsByOuterTc = extractSubAgents(events, outerAgentName);
        if (subsByOuterTc.size === 0) continue;

        // 把 sub-agents 通过外层 tool_call_id 挂到 chat_history 的 assistant 上。
        // 优先用 runId 匹配；失败时回退到"扫所有 assistant message 看 tool_calls[] 是否包含 tcId"。
        const runId = run.run_id;
        const attach = (root: ChatMessage, tcId: string) => {
          const subs = subsByOuterTc.get(tcId);
          if (!subs || subs.length === 0) return;
          const list = childMessagesByParent.get(root.id) ?? [];
          const seen = new Set(list.map((a) => a.subMessage.runId));
          for (const s of subs) {
            if (s.runId && !seen.has(s.runId)) {
              list.push({
                subMessage: { ...s, parentMessageId: root.id },
                outerToolCallId: tcId,
              });
              seen.add(s.runId);
              // 关键：用 bare runId 标记，Stage B/C 的
              // `attachedRunIds.has(cr.run_id)` 才能正确去重，
              // 防止同一个 sub-agent 被 events[] 路径和 runs[].parent_run_id
              // 路径分别挂一次（出现两个 chip）。
              attachedRunIds.add(s.runId);
            }
          }
          childMessagesByParent.set(root.id, list);
        };

        // 先按 runId 匹配
        let matchedByRunId = false;
        for (const root of messages) {
          if (root.runId === runId) {
            const rootTcIds = (root.parts ?? [])
              .filter((p) => p.type === "tool_call")
              .map((p) => (p as ToolCallPart).toolCallId);
            for (const tcId of rootTcIds) attach(root, tcId);
            matchedByRunId = true;
          }
        }

        // 兜底：用 tool_call_id 直接匹配 assistant messages
        if (!matchedByRunId) {
          for (const root of messages) {
            if (root.role !== "assistant") continue;
            const rootTcIds = (root.parts ?? [])
              .filter((p) => p.type === "tool_call")
              .map((p) => (p as ToolCallPart).toolCallId);
            for (const tcId of rootTcIds) attach(root, tcId);
          }
        }
      }

      // 阶段 B：Team 模式 — runs[].parent_run_id 真有值的情况
      // (WorkspaceContextProvider 模式 events[] 已经覆盖；这里是 Agno Team 的入口)
      const buildSubFromChildRun = (
        cr: AgRunResponse,
        parentId: string
      ): ChatMessage => {
        const subMsgs = runToChatMessages(cr);
        const sm = subMsgs[0]; // child run 作为一个 message
        return {
          ...sm,
          parentMessageId: parentId,
          agentId: cr.agent_id ?? sm.agentId,
          teamId: cr.team_id ?? sm.teamId,
          displayName:
            (cr as any).extra_data?.agent_name ??
            (cr as any).extra_data?.team_name ??
            cr.agent_id ??
            cr.team_id ??
            sm.displayName,
        };
      };
      for (const root of messages) {
        if (!root.runId) continue;
        const childRuns = childRunsByParentRunId.get(root.runId);
        if (!childRuns || childRuns.length === 0) continue;
        const list = childMessagesByParent.get(root.id) ?? [];
        for (const cr of childRuns) {
          if (!cr.run_id || attachedRunIds.has(cr.run_id)) continue;
          attachedRunIds.add(cr.run_id);
          list.push({
            subMessage: buildSubFromChildRun(cr, root.id),
            outerToolCallId: null, // Team 模式暂时没法锚定具体 tool_call
          });
        }
        childMessagesByParent.set(root.id, list);
      }

      // 阶段 C：timestamp fallback — 完全没匹配到的孤儿 child runs
      const orphanChildRuns = runs.filter(
        (r) => r.parent_run_id && r.run_id && !attachedRunIds.has(r.run_id)
      );
      if (orphanChildRuns.length > 0) {
        const userTimes = messages
          .filter((m) => m.role === "user")
          .map((m) => m.createdAt)
          .sort((a, b) => a - b);
        const assistantMsgs = messages.filter((m) => m.role === "assistant");
        if (assistantMsgs.length > 0) {
          for (const cr of orphanChildRuns) {
            const crMs = toMs(cr.created_at);
            let placed = false;
            for (let i = 0; i < userTimes.length - 1; i++) {
              const left = userTimes[i];
              const right = userTimes[i + 1];
              if (crMs >= left && crMs < right) {
                const inRange = assistantMsgs.filter(
                  (a) => a.createdAt >= left && a.createdAt <= right
                );
                if (inRange.length > 0) {
                  const closest = inRange.reduce((best, a) =>
                    Math.abs(a.createdAt - crMs) <
                    Math.abs((best?.createdAt ?? 0) - crMs)
                      ? a
                      : best
                  );
                  if (closest) {
                    const list = childMessagesByParent.get(closest.id) ?? [];
                    list.push({
                      subMessage: buildSubFromChildRun(cr, closest.id),
                      outerToolCallId: null,
                    });
                    childMessagesByParent.set(closest.id, list);
                    placed = true;
                    break;
                  }
                }
              }
            }
            if (!placed) {
              const last = assistantMsgs[assistantMsgs.length - 1];
              if (last) {
                const list = childMessagesByParent.get(last.id) ?? [];
                list.push({
                  subMessage: buildSubFromChildRun(cr, last.id),
                  outerToolCallId: null,
                });
                childMessagesByParent.set(last.id, list);
              }
            }
          }
        }
      }

      // 给每个 root message 注入 marker part，让 chip 出现在 sub-agent 触发处
      const finalMessages = messages.map((m) => {
        const anchors = childMessagesByParent.get(m.id);
        if (!anchors || anchors.length === 0) return m;
        // 1) 把 sub-messages 装进 message（取出去 anchor 信息）
        const subs = anchors
          .map((a) => a.subMessage)
          .sort((a, b) => a.createdAt - b.createdAt);
        const next: ChatMessage = { ...m, subMessages: subs };

        // 2) 收集已有的 marker（避免重复）
        const existingMarkers = new Set<string>();
        for (const p of next.parts) {
          if (p.type === "sub_message_marker") {
            existingMarkers.add((p as any).subMessageId);
          }
        }

        // 3) 按 outer tool_call_id 把 marker 紧跟对应 tool_call part 后面。
        //    没有 outerToolCallId 的 fallback 到末尾兜底。
        const newParts: MessagePart[] = [];
        const orphanMarkers: Array<{
          subMessageId: string;
          outerToolCallId: string | null;
        }> = [];
        const toolCallToAnchors = new Map<string, string[]>(); // tcId -> subMessageIds
        for (const a of anchors) {
          if (!a.subMessage.id || existingMarkers.has(a.subMessage.id)) continue;
          if (a.outerToolCallId) {
            const arr = toolCallToAnchors.get(a.outerToolCallId) ?? [];
            arr.push(a.subMessage.id);
            toolCallToAnchors.set(a.outerToolCallId, arr);
          } else {
            orphanMarkers.push({
              subMessageId: a.subMessage.id,
              outerToolCallId: null,
            });
          }
        }

        // 把 tool_call → sub-messageIds map 按 tool_call 在 parts[] 的位置排序
        const orderedInsertions: Array<{ afterIndex: number; subMessageIds: string[] }> = [];
        for (let i = 0; i < next.parts.length; i++) {
          const part = next.parts[i];
          if (part.type === "tool_call") {
            const tcId = (part as ToolCallPart).toolCallId;
            const ids = toolCallToAnchors.get(tcId);
            if (ids?.length) {
              orderedInsertions.push({ afterIndex: i, subMessageIds: ids });
            }
          }
        }

        // 重建 parts：在每个 tool_call 后插入对应 markers；orphan（不知道 tcId）追加到末尾
        let insIdx = 0;
        for (let i = 0; i < next.parts.length; i++) {
          newParts.push(next.parts[i]);
          while (
            insIdx < orderedInsertions.length &&
            orderedInsertions[insIdx].afterIndex === i
          ) {
            for (const id of orderedInsertions[insIdx].subMessageIds) {
              newParts.push({ type: "sub_message_marker", subMessageId: id });
            }
            insIdx++;
          }
        }
        // 处理孤儿（理论上不会发生——只要 outer tool_call_id 在 chat_history 的 tool_calls 里）
        for (const o of orphanMarkers) {
          newParts.push({ type: "sub_message_marker", subMessageId: o.subMessageId });
        }

        next.parts = newParts;
        return next;
      });

      get().setMessages(sessionId, finalMessages);
    } catch (err) {
      console.error("loadHistory failed", err);
    } finally {
      set({ loadingHistory: false });
    }
  },

  sendMessage: async ({ text, files, sessionId, agentId }) => {
    const instances = useInstancesStore.getState();
    const activeId = instances.activeInstanceId;
    if (!activeId) throw new Error("No active instance");
    const client = instances.getClient(activeId);
    if (!client) throw new Error("No client");

    const targetAgentId =
      agentId ?? get().selectedAgentId ?? instances.instances.find((i) => i.id === activeId)?.agents?.[0]?.id;
    if (!targetAgentId) throw new Error("No agent selected");

    const targetSessionId =
      sessionId ?? useSessionsStore.getState().currentSessionId ?? null;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      parts: [{ type: "text", text }],
      status: "completed",
      createdAt: Date.now(),
      sessionId: targetSessionId ?? undefined,
      agentId: targetAgentId,
    };

    const effectiveSessionId = targetSessionId ?? `pending-${Date.now()}`;

    get().appendMessage(effectiveSessionId, userMsg);

    // 首次消息时把 currentSessionId 切到这个新 session
    if (!targetSessionId) {
      useSessionsStore.getState().setCurrentSession(effectiveSessionId);
    }

    const runner = new ChatRunner();
    set({ runner, selectedAgentId: targetAgentId });

    const callbacks = {
      onMessageUpdate: (message: ChatMessage) => {
        const list = get().messagesBySession[effectiveSessionId] ?? [];
        const exists = !!findInTree(list, message.id);
        if (!exists) {
          // top-level 不存在（说明是新增或 sub）
          if (message.parentMessageId) {
            // sub message：找到 parent（沿树向下找）后 append
            get().appendSubMessage(
              effectiveSessionId,
              message.parentMessageId,
              message
            );
            return;
          } else {
            get().appendMessage(effectiveSessionId, message);
            return;
          }
        }
        // 已存在：原地更新
        get().updateAnyMessage(effectiveSessionId, message.id, () => message);
      },
      onSubMessageCreated: (parentMessageId: string, sub: ChatMessage) => {
        // 占位实际上由 onMessageUpdate 第一次触发时 append；这里留作 hook 给未来的 UI/逻辑。
        // 但为了在 sub 的首次 event 之前就在 UI 留空位，先 append 一份空 sub（可选）：
        const list = get().messagesBySession[effectiveSessionId] ?? [];
        const exists = !!findInTree(list, sub.id);
        if (!exists && parentMessageId) {
          // 暂时不主动创建——onMessageUpdate 在第一次 sub update 时会创建并填充。
          // 但这样 UI 在首事件到达前看不到 sub 的 placeholder。
          // 折中：先 append 一个空壳，确保用户看到 streaming 状态。
          get().appendSubMessage(
            effectiveSessionId,
            parentMessageId,
            { ...sub, parts: [] }
          );
        }
      },
      onRunStarted: (runId: string, sid?: string) => {
        if (sid && !targetSessionId) {
          // 把 effectiveSessionId 替换为真实 id，并迁移消息
          const oldKey = effectiveSessionId;
          const newKey = sid;
          const oldList = get().messagesBySession[oldKey] ?? [];
          set((s) => {
            const { [oldKey]: _, ...rest } = s.messagesBySession;
            return {
              messagesBySession: { ...rest, [newKey]: oldList },
            };
          });
          useSessionsStore.getState().setCurrentSession(newKey);
          useSessionsStore
            .getState()
            .upsertSession(activeId, {
              session_id: sid,
              session_type: "agent",
              agent_id: targetAgentId,
              created_at: Math.floor(Date.now() / 1000),
              updated_at: Math.floor(Date.now() / 1000),
              last_message_preview: text.slice(0, 100),
            } as any);
        }
      },
      onRunCompleted: () => {
        // 完成后刷新 session 列表
        useSessionsStore.getState().loadSessions(activeId, true);
      },
      onRunError: (runId: string, err: string) => {
        console.error("Run error", runId, err);
      },
      onRunPaused: () => {
        // pause 状态由 runner 内部状态驱动，UI 层会读取 awaitingInput
      },
    };

    await runner.run(
      {
        client,
        agentId: targetAgentId,
        message: text,
        sessionId: targetSessionId,
        userId: null,
        files,
      },
      callbacks
    );
  },

  cancelRun: async () => {
    const runner = get().runner;
    if (!runner) return;
    const runId = runner.getCurrentRunId();
    const agentId = get().selectedAgentId;
    const activeId = useInstancesStore.getState().activeInstanceId;
    const topMsg = runner.getCurrentMessage();
    const sessionId =
      topMsg?.sessionId ??
      runner.getCurrentSessionId() ??
      useSessionsStore.getState().currentSessionId ??
      undefined;
    runner.abort();

    // 把对应 session 内还在 streaming / paused 的所有消息（含任意深度的 sub）标记为 cancelled。
    if (sessionId) {
      const list = get().messagesBySession[sessionId] ?? [];
      const update = get().updateAnyMessage;
      const walk = (ms: ChatMessage[]) => {
        for (const m of ms) {
          if (m.status === "streaming" || m.status === "paused") {
            const nextStatus = m.status === "paused" ? "paused" : "cancelled";
            update(sessionId, m.id, (cur) => ({
              ...cur,
              status: nextStatus as ChatMessage["status"],
            }));
          }
          if (m.subMessages && m.subMessages.length > 0) {
            walk(m.subMessages);
          }
        }
      };
      walk(list);
    }

    if (runId && agentId && activeId) {
      const client = useInstancesStore.getState().getClient(activeId);
      if (client) {
        try {
          await client.cancelAgentRun(agentId, runId);
        } catch (err) {
          console.warn("cancel failed", err);
        }
      }
    }
    set({ runner: null });
  },

  continueRun: async (toolResults) => {
    const runner = get().runner;
    if (!runner) return;
    const runId = runner.getCurrentRunId();
    const sessionId = runner.getCurrentSessionId();
    const agentId = get().selectedAgentId;
    const activeId = useInstancesStore.getState().activeInstanceId;
    if (!runId || !agentId || !activeId) return;
    const client = useInstancesStore.getState().getClient(activeId);
    if (!client) return;

    const currentMessage = runner.getCurrentMessage();
    const callbacks = {
      onMessageUpdate: (m: ChatMessage) => {
        const session = m.sessionId ?? sessionId ?? "";
        // 顶层或 sub 都用 updateAnyMessage
        get().updateAnyMessage(session, m.id, () => m);
      },
      onChunk: () => {},
      onRunCompleted: () => {
        useSessionsStore.getState().loadSessions(activeId, true);
      },
    };

    await runner.continueRun(
      {
        client,
        agentId,
        runId,
        sessionId,
        userId: null,
        toolResults,
      },
      callbacks
    );
  },

  newSession: (agentId) => {
    const id = `local-${Date.now()}`;
    useSessionsStore.getState().setCurrentSession(id);
    if (agentId) get().setSelectedAgent(agentId);
    return id;
  },
}));

const EMPTY_MESSAGES: ChatMessage[] = [];

export function useCurrentSessionMessages(sessionId: string | null) {
  return useChatStore((s) => {
    if (!sessionId) return EMPTY_MESSAGES;
    return s.messagesBySession[sessionId] ?? EMPTY_MESSAGES;
  });
}
