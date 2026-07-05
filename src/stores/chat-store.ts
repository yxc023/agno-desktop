/**
 * Chat store: 当前 session 的消息列表 + 当前选中的 agent
 *
 * 设计:
 * - messages 存所有 message
 * - ChatRunner 在 stream 过程中通过回调更新
 * - 一个 ChatRunner 实例对应"一次 run"
 */

import { create } from "zustand";
import { ChatRunner } from "@/lib/chat-runner";
import type { ChatMessage, MessagePart } from "@/lib/message-types";
import { useInstancesStore } from "./instances-store";
import { useSessionsStore } from "./sessions-store";
import { generateId } from "@/lib/utils";

function safeParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

interface ChatState {
  /** 当前 session 的所有消息 */
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
      const runById = new Map<string, any>();
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

      get().setMessages(sessionId, messages);
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
        const idx = list.findIndex((m) => m.id === message.id);
        if (idx === -1) {
          get().appendMessage(effectiveSessionId, message);
        } else {
          get().updateMessage(effectiveSessionId, message.id, () => message);
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
    runner.abort();
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
        get().updateMessage(session, m.id, () => m);
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