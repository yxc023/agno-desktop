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
import type { ChatMessage, MessagePart } from "@/lib/message-types";
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

/** 替换树中的某条 message（返回新数组）。 */
function replaceInTree(
  messages: ChatMessage[],
  id: string,
  updater: (m: ChatMessage) => ChatMessage
): ChatMessage[] {
  return messages.map((m) => {
    if (m.id === id) return updater(m);
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
      // 对每条 assistant 消息，如果其 runId 对应 root run 且有 child runs，
      // 把 child runs 转成 ChatMessage[] 挂到 subMessages。
      const childMessagesByParent = new Map<string, ChatMessage[]>();
      for (const root of messages) {
        if (!root.runId) continue;
        const childRuns = childRunsByParentRunId.get(root.runId);
        if (!childRuns || childRuns.length === 0) continue;
        const subs: ChatMessage[] = [];
        for (const cr of childRuns) {
          const subMsgs = runToChatMessages(cr);
          for (const sm of subMsgs) {
            subs.push({
              ...sm,
              parentMessageId: root.id,
              // parentRunId implied but not exposed in ChatMessage
              agentId: cr.agent_id ?? sm.agentId,
              teamId: cr.team_id ?? sm.teamId,
              displayName:
                (cr as any).extra_data?.agent_name ??
                (cr as any).extra_data?.team_name ??
                cr.agent_id ??
                cr.team_id ??
                sm.displayName,
            });
          }
        }
        if (subs.length > 0) {
          childMessagesByParent.set(root.id, subs);
        }
      }

      // Attach sub messages to their roots (immutable)
      const finalMessages = messages.map((m) => {
        const subs = childMessagesByParent.get(m.id);
        if (subs) {
          return { ...m, subMessages: subs };
        }
        return m;
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

    // 把对应 session 内还在 streaming 的 top + sub 全部标记为 cancelled
    if (sessionId) {
      const list = get().messagesBySession[sessionId] ?? [];
      const markCancelled = (m: { id: string; status: string; parentMessageId?: string }) => {
        if (m.status === "streaming" || m.status === "paused") {
          const nextStatus = m.status === "paused" ? "paused" : "cancelled";
          get().updateAnyMessage(sessionId, m.id, (cur) => ({
            ...cur,
            status: nextStatus as ChatMessage["status"],
          }));
        }
      };
      for (const m of list) {
        markCancelled(m);
        if (m.subMessages) for (const s of m.subMessages) markCancelled(s);
      }
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
