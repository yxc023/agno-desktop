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
import { displayNameForRun } from "@/lib/agent-name";
import { useInstancesStore } from "./instances-store";
import { useSessionsStore } from "./sessions-store";
import { generateId } from "@/lib/utils";
import type { AgChatMessage, AgRunResponse } from "@/lib/agno-types";

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/**
 * 从 runs[] 重建一份 fallback 的 AgChatMessage[]，用于 chat_history 缺失时。
 *
 * 触发场景（AGNO server 端在某些 session 上没把 chat_history 持久化进数据库，
 * 但 run 的 content / events 都正常存了）：
 *   - workflow / multi-step session 命中率更高
 *   - 现象：detail.chat_history === [] 但 runs.length > 0
 *   - 结果：UI 永远显示 "empty chat"，用户看不到已有答案
 *
 * 算法：
 *   1. 对每个 run：
 *      - 优先用 run.content（AGNO 已经把完整输出存到了 run 顶层）；
 *        验证过它 === RunContent events 拼起来的结果，不会丢信息。
 *      - 退路：聚合该 run_id 的 RunContent events 拼字符串。
 *      - 都没有 → 这个 run 跳过（events 流不完整，不强造空内容）。
 *   2. 按 createdAt 升序。
 *   3. 拼成 AgChatMessage（id 用 run_id，方便后续 sub-agent 重建的 runId 匹配
 *      找到 root message 把 sub-agent 挂上）。
 *
 * 注意：**不构造 user 消息**——run_input 也常常为 null，瞎猜一个 user message
 * 反而误导。fallback 模式允许"只看到 assistant 答案"，至少比"什么都看不到"强。
 */
function buildFallbackHistoryFromRuns(
  runs: AgRunResponse[]
): AgChatMessage[] {
  // 按 run_id 聚合 RunContent events（兜底用）
  const streamedByRun = new Map<string, string[]>();
  for (const r of runs) {
    for (const ev of r.events ?? []) {
      if (ev?.event === "RunContent") {
        const rid = ev.run_id;
        const c = ev.content;
        if (rid && typeof c === "string" && c.length > 0) {
          let arr = streamedByRun.get(rid);
          if (!arr) {
            arr = [];
            streamedByRun.set(rid, arr);
          }
          arr.push(c);
        }
      }
    }
  }

  // 顶层 run.content 已经把 RunCompleted 的 content 持久化过（agentOS 在 run 落库
  // 时把流拼好再写）。这里直接用，省一次聚合 + 对 content_type='str' 的内容更准。
  const out: AgChatMessage[] = [];
  const sorted = [...runs].sort((a, b) => toMs(a.created_at) - toMs(b.created_at));
  for (const r of sorted) {
    if (!r.run_id) continue;

    let content: any = undefined;
    // 1) 顶层 content：非空字符串 或 非空对象（str/structured）
    if (r.content != null && r.content !== "") {
      content = r.content;
    } else {
      // 2) 聚合 events
      const streamed = streamedByRun.get(r.run_id);
      if (streamed && streamed.length > 0) {
        content = streamed.join("");
      }
    }
    if (content === undefined) continue;

    const createdAt = toMs(r.created_at) || Date.now();
    out.push({
      id: r.run_id,
      role: "assistant",
      content,
      created_at: createdAt,
      // 给 happy path 里 metrics / reasoning 的解析留钩子
      reasoning_content: r.reasoning_content || undefined,
      reasoning_steps: r.reasoning_steps || undefined,
      metrics: r.metrics,
      // 顶层 run 还可能带 tool_calls（agent 调工具的场景）——原样透传
      tool_calls: r.messages?.flatMap((m) => m.tool_calls ?? []).filter(Boolean) || undefined,
    });
  }
  return out;
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
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** messagesBySession 的 LRU 上限。超过后最久未访问的 session 会被清空。 */
const MESSAGES_BY_SESSION_LRU_LIMIT = 20;

/** loadHistory 的 in-flight generation map：单调递增整数，
 *  用于检测"我的请求还没回，又有新的 loadHistory 启动了"，过时回调直接 no-op。 */
const loadHistoryGeneration = new Map<string, number>();

/** Build a recursive id → message index for a chat tree. */
function buildIdIndex(
  messages: ChatMessage[]
): Map<string, ChatMessage> {
  const out = new Map<string, ChatMessage>();
  const walk = (ms: ChatMessage[]) => {
    for (const m of ms) {
      if (m.id) out.set(m.id, m);
      if (m.subMessages && m.subMessages.length > 0) walk(m.subMessages);
    }
  };
  walk(messages);
  return out;
}

/** 给 set() 用的 LRU 收紧辅助：在 messagesBySession 中保留最近访问的 N 个。 */
function pruneMessagesBySession(
  map: Record<string, ChatMessage[]>,
  limit: number
): Record<string, ChatMessage[]>;
function pruneMessagesBySession<T>(
  map: Record<string, T>,
  limit: number
): Record<string, T>;
function pruneMessagesBySession<T>(
  map: Record<string, T>,
  limit: number
): Record<string, T> {
  const keys = Object.keys(map);
  if (keys.length <= limit) return map;
  // Object key order is insertion order in modern JS engines; we treat
  // it as access order on best-effort (the touched sessions are
  // re-assigned below via a fresh object).
  const keep = new Set(keys.slice(keys.length - limit));
  const next: Record<string, T> = {};
  for (const k of keys) {
    if (keep.has(k)) next[k] = map[k];
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface ChatState {
  /** 当前 session 的所有 top-level 消息 */
  messagesBySession: Record<string, ChatMessage[]>;
  /**
   * 每个 session 的 id → ChatMessage 索引（任意深度）。在 setMessages 时
   * 重建，使 SubAgentSidePanel / SubMessageMarkerChip 的 findInTree
   * 退化为 O(1) lookup。Chats with many sub-messages or deep
   * sub-of-sub trees benefit the most.
   */
  idIndexBySession: Record<string, Map<string, ChatMessage>>;
  /**
   * Per-session loading state。点击 session 后到 history 落地前的"窗口期"
   * 内，UI 用 loadingHistoryBySession[id] 来决定渲染 skeleton 还是 empty
   * state，避免短暂闪烁 ChatEmptyState。loadedHistoryBySession[id]
   * 记录"至少拉过一次"——session 从未拉过历史时也按 loading 处理，
   * 杜绝切到从未打开过的 session 时跳一下 empty state。
   */
  loadingHistoryBySession: Record<string, boolean>;
  loadedHistoryBySession: Record<string, boolean>;
  /** 当前选中的 agent/team/workflow id */
  selectedAgentId: string | null;
  selectedType: "agent" | "team" | "workflow";
  /** 当前的 ChatRunner */
  runner: ChatRunner | null;
  /**
   * 旧的全局 loadingHistory 字段保留向后兼容（部分早期 selector
   * 还在引用），实际渲染逻辑已切换到 loadingHistoryBySession[id]。
   */
  loadingHistory: boolean;
  /** 最近一次 loadHistory 的错误信息（success / fallback 路径不设置）。UI 可以
   *  据此决定是否显示 banner / 提示用户"部分历史可能不完整"。 */
  loadHistoryError: string | null;

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
      // AGNO sometimes emits an "anchor" assistant message with no content,
      // no reasoning, and no tool calls — usually because the sub-agent
      // delegation that follows is the only thing this turn produced. We
      // currently drop these (matching flushAssistant's behavior), but log
      // a warning so future debugging isn't a silent black hole.
      if (typeof console !== "undefined") {
        console.debug(
          "runToChatMessages: dropping empty assistant message",
          { id: m.id, role: m.role, hasToolCalls: !!m.tool_calls?.length }
        );
      }
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
      displayName: displayNameForRun(run) ?? undefined,
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
  loadHistoryError: null,
  idIndexBySession: {},
  loadingHistoryBySession: {},
  loadedHistoryBySession: {},

  setSelectedAgent: (id, type = "agent") =>
    set({ selectedAgentId: id, selectedType: type }),

  setMessages: (sessionId, messages) =>
    set((s) => {
      // 把目标 session 重新插入到 map 末尾（标记为最近访问），再做 LRU 收紧。
      const next: Record<string, ChatMessage[]> = {};
      for (const [k, v] of Object.entries(s.messagesBySession)) {
        if (k !== sessionId) next[k] = v;
      }
      next[sessionId] = messages;
      // idIndex 同步：每个 setMessages 都重建一次（O(N) 单次扫描），
      // 之后 findInTree 退化为 O(1)。LRU 收紧时丢弃的 session 也丢弃 index。
      const newIndex: Record<string, Map<string, ChatMessage>> = {};
      for (const [k, v] of Object.entries(s.idIndexBySession)) {
        if (k !== sessionId) newIndex[k] = v;
      }
      newIndex[sessionId] = buildIdIndex(messages);
      const nextLoading: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(s.loadingHistoryBySession)) {
        if (k !== sessionId) nextLoading[k] = v;
      }
      nextLoading[sessionId] = false;
      const nextLoaded: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(s.loadedHistoryBySession)) {
        if (k !== sessionId) nextLoaded[k] = v;
      }
      nextLoaded[sessionId] = true;
      return {
        messagesBySession: pruneMessagesBySession(
          next,
          MESSAGES_BY_SESSION_LRU_LIMIT
        ),
        idIndexBySession: pruneMessagesBySession(
          newIndex,
          MESSAGES_BY_SESSION_LRU_LIMIT
        ),
        loadingHistoryBySession: pruneMessagesBySession(
          nextLoading,
          MESSAGES_BY_SESSION_LRU_LIMIT
        ),
        loadedHistoryBySession: pruneMessagesBySession(
          nextLoaded,
          MESSAGES_BY_SESSION_LRU_LIMIT
        ),
      };
    }),

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
      const { [sessionId]: __, ...restLoaded } = s.loadedHistoryBySession;
      const { [sessionId]: ___, ...restLoading } = s.loadingHistoryBySession;
      return {
        messagesBySession: rest,
        loadedHistoryBySession: restLoaded,
        loadingHistoryBySession: restLoading,
      };
    }),

  loadHistory: async (sessionId) => {
    const activeId = useInstancesStore.getState().activeInstanceId;
    if (!activeId) return;
    const client = useInstancesStore.getState().getClient(activeId);
    if (!client) return;
    // in-flight token: 同一 sessionId 多次并发 loadHistory 时，
    // 只有最后一次的 setMessages 会落地。早于当前 generation 的回调
    // 直接 no-op，避免慢请求覆盖快请求的 state。
    const myGen = (loadHistoryGeneration.get(sessionId) ?? 0) + 1;
    loadHistoryGeneration.set(sessionId, myGen);
    set((s) => ({
      loadingHistory: true,
      loadHistoryError: null,
      loadingHistoryBySession: {
        ...s.loadingHistoryBySession,
        [sessionId]: true,
      },
    }));
    try {
      // 并行拉取 session 详情和 runs。getSessionRuns 失败时仍继续
      // （chat_history 本身是 OK 的，只是 sub-agent 历史会缺），但暴露
      // 给 store 让 UI 可以提示。
      const [detail, runsResult] = await Promise.all([
        client.getSession(sessionId),
        client
          .getSessionRuns(sessionId)
          .then(
            (r) => ({ ok: true as const, value: r }),
            (err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn(
                "loadHistory: getSessionRuns failed; sub-agent history will be missing",
                { sessionId, error: msg }
              );
              return { ok: false as const, error: msg };
            }
          ),
      ]);
      const runs = runsResult.ok
        ? runsResult.value
        : ([] as Awaited<ReturnType<typeof client.getSessionRuns>>);
      if (!runsResult.ok) {
        set({ loadHistoryError: runsResult.error });
      }
      const history = detail.chat_history ?? [];

      // chat_history 缺失 fallback：AGNO 服务端在某些 session（多为 workflow / 多步
      // session）上没把 chat_history 持久化进 DB，但 runs[].content 和 events 都在。
      // 旧逻辑会直接落到 "empty chat" 状态——用户看到空对话但实际后端有完整答案。
      // 这里合成一份 history，让现有 happy path（含 sub-agent 重建）自然跑起来。
      // user message 我们没法恢复（run_input 经常也是 null），所以 fallback 模式
      // 会看到"只有 assistant 答案"——比"什么都看不到"好太多。
      const hasRealHistory = history.length > 0;
      const effectiveHistory: AgChatMessage[] = hasRealHistory
        ? history
        : runs.length > 0
        ? buildFallbackHistoryFromRuns(runs)
        : history;
      if (!hasRealHistory && effectiveHistory.length > 0) {
        // console.warn 让 dev 在排查"点进 session 看到的内容比预期少"时能立刻
        // 定位是 server 端持久化缺口（不是前端 bug）。
        if (typeof console !== "undefined") {
          console.warn(
            "loadHistory: chat_history missing, fell back to runs[] (server-side persistence gap)",
            { sessionId, runsCount: runs.length, fallbackMsgs: effectiveHistory.length }
          );
        }
      }

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

      for (const m of effectiveHistory) {
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
          if (parts.length === 0) {
            // AGNO 偶尔发出"锚定"用的空 assistant：没 content、没 reasoning、没 tool_calls。
            // 跳掉它（与 runToChatMessages 行为一致），但打 debug log 以便排查。
            if (typeof console !== "undefined") {
              console.debug(
                "loadHistory: dropping empty assistant from chat_history",
                { id: m.id, role: m.role }
              );
            }
            continue;
          }
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
        const reasoningSteps: Array<{
          title?: string;
          reasoning?: string;
          action?: string;
          result?: string;
        }> = [];
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

          const evName: string = ev.event ?? "";
          const toolObj: any = ev.tool ?? null;

          // reasoning (text)
          const r =
            typeof ev.reasoning_content === "string"
              ? ev.reasoning_content
              : typeof ev.reasoning === "string"
              ? ev.reasoning
              : null;
          if (r) reasoningText += r;

          // reasoning (per-step) — AGNO emits these either as
          // `ev.event === "ReasoningStep"` with the step in
          // `ev.reasoning_step`, or inline via `ev.reasoning_step`
          // attached to other events.
          const stepObj =
            (ev.reasoning_step ?? ev.step) &&
            typeof (ev.reasoning_step ?? ev.step) === "object"
              ? (ev.reasoning_step ?? ev.step)
              : null;
          if (stepObj) {
            reasoningSteps.push({
              title: stepObj.title,
              reasoning: stepObj.reasoning,
              action: stepObj.action,
              result: stepObj.result,
            });
          }

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

        if (reasoningText.trim() || reasoningSteps.length > 0) {
          parts.unshift({
            type: "reasoning",
            text: reasoningText,
            steps: reasoningSteps.length > 0 ? reasoningSteps : undefined,
          });
        }

        const durationMs =
          createdAt && subEvents[subEvents.length - 1]?.created_at
            ? (() => {
                const lastTs = subEvents[subEvents.length - 1].created_at;
                const last = lastTs > 1e12 ? lastTs : lastTs * 1000;
                // Clamp to ≥0 — events may arrive out-of-order (clock skew,
                // batched persistence), and SidePanel renders duration as
                // "(duration/1000).toFixed(1)s"; a negative value renders
                // garbage like "-0.5s".
                return Math.max(0, last - createdAt);
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
              let bucket = scopeEventsBySubId.get(subRunId);
              if (!bucket) {
                bucket = [];
                scopeEventsBySubId.set(subRunId, bucket);
              }
              bucket.push(ev);
            }
          }
        }
        // 兜底：文件末尾还可能开着一个 scope
        flushScope();
        return out;
      };

        // 阶段 A：从 events[] 提取——这是 AGNO 当前最可靠的数据源
        for (const run of runs) {
          const events = run.events;
          if (!Array.isArray(events) || events.length === 0) continue;
          const outerAgentName =
            run.agent_name ??
            (events.find((e: any) => e?.agent_name)?.agent_name as string) ??
          "";
        if (!outerAgentName) {
          // events[] 是有的，但没有任何 agent_name。可能是 AGNO 改了 schema，
          // 也可能是 events[] 都是 sub-agent 事件。这里打 warning 以便排查，
          // 不会因此把整个 sub-agent 重建路径关掉（仍会走 Stage B/C 兜底）。
          if (typeof console !== "undefined") {
            console.warn(
              "loadHistory: events[] present but no agent_name; sub-agent reconstruction for this run may be partial",
              { run_id: run.run_id, eventCount: events.length }
            );
          }
          continue;
        }
        const subsByOuterTc = extractSubAgents(events, outerAgentName);
        if (subsByOuterTc.size === 0) {
          // events[] 里有 outer 标识但没拆出任何 sub-agent——多半是
          // outer 没调 sub 工具。silent 即可，不打 warning。
          continue;
        }

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
          displayName: displayNameForRun(cr) ?? sm.displayName,
        };
      };
      // 阶段 B：Team 模式 — runs[].parent_run_id 真有值的情况
      // (WorkspaceContextProvider 模式 events[] 已经覆盖；这里是 Agno Team 的入口)
      //
      // 多级嵌套处理：buildSubFromChildRun 之前 hardcode 了 parentMessageId = root.id，
      // 让 sub-of-sub 失去真实父级（被当 root 的兄弟挂上去）。现在用 runIdToSub
      // 跟踪已创建的 sub，cr.parent_run_id 指向某个 sub 时，把它挂到那个 sub 下。
      const runIdToSub = new Map<string, ChatMessage>();
      for (const root of messages) {
        if (!root.runId) continue;
        const childRuns = childRunsByParentRunId.get(root.runId);
        if (!childRuns || childRuns.length === 0) continue;
        const list = childMessagesByParent.get(root.id) ?? [];
        for (const cr of childRuns) {
          if (!cr.run_id || attachedRunIds.has(cr.run_id)) continue;
          attachedRunIds.add(cr.run_id);
          const subMsg = buildSubFromChildRun(cr, root.id);
          runIdToSub.set(cr.run_id, subMsg);
          list.push({
            subMessage: subMsg,
            outerToolCallId: null, // Team 模式暂时没法锚定具体 tool_call
          });
        }
        childMessagesByParent.set(root.id, list);
      }

      // 多级嵌套（sub-of-sub）：cr.parent_run_id 指向某个已创建的 sub 时，
      // 把这个 cr 挂到那个 sub 下面，而不是 root。
      // 拓扑：parentRunId 总是先于子 run_id 出现（AGNO 的事件排序保证），
      // 所以 runIdToSub 一定先有 parent。
      for (const cr of runs) {
        if (!cr.run_id || !cr.parent_run_id) continue;
        if (attachedRunIds.has(cr.run_id)) continue;
        const parentSub = runIdToSub.get(cr.parent_run_id);
        if (!parentSub) continue; // 既不是 root 的子（Stage B 第一段漏过）、也不是已知 sub 的子
        attachedRunIds.add(cr.run_id);
        const subMsg = buildSubFromChildRun(cr, parentSub.id);
        runIdToSub.set(cr.run_id, subMsg);
        const list = childMessagesByParent.get(parentSub.id) ?? [];
        list.push({
          subMessage: subMsg,
          outerToolCallId: null,
        });
        childMessagesByParent.set(parentSub.id, list);
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

      // 给每个 root message 注入 marker part，让 chip 出现在 sub-agent 触发处。
      // 递归处理：sub-of-sub 的 sub 也要走同样的流程。
      const attachAnchors = (msg: ChatMessage): ChatMessage => {
        const anchors = childMessagesByParent.get(msg.id);
        if (!anchors || anchors.length === 0) return msg;
        // 1) 把 sub-messages 装进 message（取出去 anchor 信息）
        const subs = anchors
          .map((a) => a.subMessage)
          // 同一 outer tool_call 在 AGNO 重发场景下可能塞进两个 createdAt 一样的
          // sub-message。tie-breaker 用 subMessage.id 让顺序 deterministic。
          .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
        // 递归：sub 自己也可能有 childMessagesByParent 项（sub-of-sub）
        const subsWithChildren = subs.map((s) => attachAnchors(s));
        const next: ChatMessage = { ...msg, subMessages: subsWithChildren };

        // 2) 收集已有的 marker（避免重复）
        const existingMarkers = new Set<string>();
        for (const p of next.parts) {
          if (p.type === "sub_message_marker") {
            existingMarkers.add(p.subMessageId);
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
      };

      const finalMessages = messages.map((m) => attachAnchors(m));

      // 如果自 fetch 开始后又有更新的 loadHistory 触发，跳过本轮的 setMessages
      // —— 后启动的请求会负责最终的 state 落地。
      if (loadHistoryGeneration.get(sessionId) === myGen) {
        get().setMessages(sessionId, finalMessages);
      }
    } catch (err) {
      console.error("loadHistory failed", err);
      if (loadHistoryGeneration.get(sessionId) === myGen) {
        const msg = err instanceof Error ? err.message : String(err);
        set({ loadHistoryError: msg });
      }
    } finally {
      if (loadHistoryGeneration.get(sessionId) === myGen) {
        set((s) => ({
          loadingHistory: false,
          loadingHistoryBySession: {
            ...s.loadingHistoryBySession,
            [sessionId]: false,
          },
          loadedHistoryBySession: {
            ...s.loadedHistoryBySession,
            [sessionId]: true,
          },
        }));
      }
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

/**
 * 在 store 维护的 id 索引里 O(1) 查 sub-message。组件用 \`useSubMessageById\` 替代
 * 直接 \`findInTree(messages, id)\` 避免每次 render 都做 O(depth × siblings) 扫描。
 * 当 id 索引中找不到时返回 null（与 findInTree 行为一致）。
 */
const EMPTY_MESSAGE: ChatMessage | null = null;
export function useSubMessageById(
  sessionId: string | null,
  subMessageId: string | null
): ChatMessage | null {
  return useChatStore((s) => {
    if (!sessionId || !subMessageId) return null;
    const idx = s.idIndexBySession[sessionId];
    if (!idx) return null;
    return idx.get(subMessageId) ?? null;
  });
}
