/**
 * ChatRunner: 把 AGNO SSE 流归约为 ChatMessage 状态
 *
 * 设计:
 * - 每个 ChatRunner 实例对应一次"run"（不是整个 session）
 * - 持有 AbortController 用于取消
 * - 把 event 派发到 reducer，更新 messages[] 中的目标 message
 *
 * **Sub-agent 支持**（team / multi-agent 场景）：
 * - 同一条 SSE 流里可能夹杂 team 自己的事件和它委派给 member agent 的事件
 * - 通过 `data.parent_run_id` 区分：parent_run_id 等于 top run_id 的事件属于 sub-agent
 * - 每个 sub-agent 产生的事件归约到一个独立的 `ChatMessage`，挂到 top message 的
 *   `subMessages[]` 下，从而实现"父回应 + 子 agent 各自独立展示"。
 */

import { AgnoClient } from "./agno-client";
import type { AgRunResponse, AgToolCall } from "./agno-types";
import {
  type ChatMessage,
  type ToolCallPart,
  generateIdPlaceholder,
} from "./message-types-helpers";
import { parseSSEData } from "./sse-parser";
import { safeJsonParse } from "./utils";

export interface ChatRunnerCallbacks {
  /** 更新一条消息（top 或 sub 都通过它出去；store 通过 message.parentMessageId 决定落到哪里）。 */
  onMessageUpdate: (message: ChatMessage) => void;
  onRunStarted?: (runId: string, sessionId?: string) => void;
  onRunCompleted?: (runId: string, message: ChatMessage) => void;
  onRunError?: (runId: string, error: string) => void;
  onRunPaused?: (runId: string, info: ChatMessage["pauseInfo"]) => void;
  onChunk?: (text: string) => void;
  /** 一个新的 sub-agent message 被创建（用于在 store 里预先占位等）。 */
  onSubMessageCreated?: (parentMessageId: string, sub: ChatMessage) => void;
  /** sub 消息的最终化（completed/error/cancelled），用于聚合状态。 */
  onSubMessageFinalized?: (parentMessageId: string, sub: ChatMessage) => void;
}

export interface RunAgentParams {
  client: AgnoClient;
  agentId: string;
  message: string;
  sessionId?: string | null;
  userId?: string | null;
  files?: File[];
  /** 已存在但还未完成的 message（用于继续流） */
  existingAssistantMessage?: ChatMessage;
}

export class ChatRunner {
  private abortController: AbortController | null = null;
  /** 顶层 run 的 run_id（team 自己的 run，或普通 agent 的 run）。 */
  private topRunId: string | null = null;
  private currentSessionId: string | null = null;
  /** 顶层 assistant message（team/agent 自己的回应）。 */
  private topMessage: ChatMessage | null = null;
  /** 所有 sub-agent 消息，按 run_id 索引。 */
  private subMessages = new Map<string, ChatMessage>();

  isRunning() {
    return this.abortController !== null;
  }

  getCurrentRunId() {
    return this.topRunId;
  }

  getCurrentSessionId() {
    return this.currentSessionId;
  }

  getCurrentMessage() {
    return this.topMessage;
  }

  /** 返回当前所有消息（top + subs），用于调试或聚合。 */
  getAllMessages(): ChatMessage[] {
    const out: ChatMessage[] = [];
    if (this.topMessage) out.push(this.topMessage);
    for (const sub of this.subMessages.values()) out.push(sub);
    return out;
  }

  abort() {
    // 设置 abort signal；store 端的 cancelRun 会同时把对应消息标记为
    // cancelled/paused（chat-store.ts 的 cancelRun → updateAnyMessage），
    // 不需要再在 runner 本地重复做这件事——本地 mutation 不会被任何
    // callback 推到 store，纯粹是 dead code。
    this.abortController?.abort();
    this.abortController = null;
  }

  async run(
    params: RunAgentParams,
    callbacks: ChatRunnerCallbacks
  ): Promise<void> {
    this.abortController = new AbortController();

    const existing = params.existingAssistantMessage;
    this.topMessage = existing
      ? { ...existing, status: "streaming" }
      : {
          id: generateIdPlaceholder(),
          role: "assistant",
          parts: [],
          status: "streaming",
          createdAt: Date.now(),
          agentId: params.agentId,
        };
    if (params.sessionId) this.topMessage.sessionId = params.sessionId;
    callbacks.onMessageUpdate(this.topMessage);

    try {
      const stream = params.client.runAgent(
        params.agentId,
        {
          message: params.message,
          stream: true,
          session_id: params.sessionId ?? null,
          user_id: params.userId ?? null,
          files: params.files,
        },
        this.abortController.signal
      );

      for await (const event of stream) {
        if (this.abortController.signal.aborted) break;
        const data = parseSSEData<AgRunResponse>(event);
        if (!data) continue;

        this.routeEvent(data, callbacks);
      }

      if (this.topMessage) {
        if (this.topMessage.status === "streaming") {
          this.topMessage.status = "completed";
        }
        callbacks.onMessageUpdate(this.topMessage);
        callbacks.onRunCompleted?.(
          this.topRunId ?? "",
          this.topMessage
        );
      }
    } catch (err) {
      if (this.abortController.signal.aborted) {
        // 主动取消 — 已 markAllCancelled
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (this.topMessage) {
        this.topMessage.status = "error";
        this.topMessage.error = msg;
        this.topMessage.parts.push({ type: "error", message: msg });
        callbacks.onMessageUpdate(this.topMessage);
      }
      callbacks.onRunError?.(this.topRunId ?? "", msg);
    } finally {
      this.abortController = null;
    }
  }

  /**
   * 继续一个被暂停的 run（HITL）
   */
  async continueRun(
    params: {
      client: AgnoClient;
      agentId: string;
      runId: string;
      sessionId?: string | null;
      userId?: string | null;
      toolResults: Array<{ tool_call_id: string; content: string }>;
    },
    callbacks: ChatRunnerCallbacks
  ): Promise<void> {
    this.abortController = new AbortController();
    this.topRunId = params.runId;
    this.currentSessionId = params.sessionId ?? null;

    if (this.topMessage) {
      this.topMessage.status = "streaming";
      this.topMessage.awaitingInput = false;
      callbacks.onMessageUpdate(this.topMessage);
    }

    try {
      const stream = params.client.continueAgentRun(
        params.agentId,
        params.runId,
        {
          tools: params.toolResults,
          session_id: params.sessionId ?? null,
          user_id: params.userId ?? null,
          stream: true,
        },
        this.abortController.signal
      );

      for await (const event of stream) {
        if (this.abortController.signal.aborted) break;
        const data = parseSSEData<AgRunResponse>(event);
        if (!data) continue;
        this.routeEvent(data, callbacks);
      }

      if (this.topMessage) {
        this.topMessage.status = "completed";
        callbacks.onMessageUpdate(this.topMessage);
        callbacks.onRunCompleted?.(params.runId, this.topMessage);
      }
    } catch (err) {
      if (this.abortController.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (this.topMessage) {
        this.topMessage.status = "error";
        this.topMessage.error = msg;
        this.topMessage.parts.push({ type: "error", message: msg });
        callbacks.onMessageUpdate(this.topMessage);
      }
      callbacks.onRunError?.(params.runId, msg);
    } finally {
      this.abortController = null;
    }
  }

  /**
   * 路由一个 SSE event 到正确的 message（top 或 sub）。
   */
  private routeEvent(data: AgRunResponse, callbacks: ChatRunnerCallbacks) {
    const runId = data.run_id ?? this.topRunId;
    const parentRunId = data.parent_run_id ?? null;

    // 1) 首个事件确立 top run — 仅当它是顶层事件（没有 parent_run_id）时才认定。
    // 之前会把"任意第一个 event"当成 top，导致 sub-agent 的事件先到时被错认为 top，
    // 后续真正的 outer 事件全部路由进错的 message 树。
    if (
      !this.topRunId &&
      runId &&
      (parentRunId === null || parentRunId === undefined)
    ) {
      this.topRunId = runId;
      if (this.topMessage) {
        this.topMessage.runId = runId;
        if (data.session_id && !this.currentSessionId) {
          this.currentSessionId = data.session_id;
          this.topMessage.sessionId = data.session_id;
        }
      }
      callbacks.onRunStarted?.(runId, data.session_id);
    } else if (data.session_id && !this.currentSessionId) {
      this.currentSessionId = data.session_id;
      if (this.topMessage) this.topMessage.sessionId = data.session_id;
    }

    // 2) 决定 target message
    const target = this.resolveTarget(runId, parentRunId, data, callbacks);
    if (!target) return;

    // 3) 应用事件
    const prevStatus = target.status;
    const isSub = target !== this.topMessage;
    this.applyEvent(target, data, callbacks);

    // 4) 通知
    callbacks.onMessageUpdate(target);
    if (isSub && prevStatus === "streaming" && target.status !== "streaming") {
      callbacks.onSubMessageFinalized?.(
        target.parentMessageId ?? "",
        target
      );
    }
  }

  /**
   * 找到或创建事件对应的 ChatMessage。
   * - run_id 为 topRunId 或没有 parent_run_id → 顶层 message
   * - parent_run_id == topRunId（或中间 node） → sub-message，按需创建
   */
  private resolveTarget(
    runId: string | null,
    parentRunId: string | null,
    data: AgRunResponse,
    callbacks: ChatRunnerCallbacks
  ): ChatMessage | null {
    // Case A: 没有 runId（极少见，可能老版本）→ top
    if (!runId) return this.topMessage;

    // Case B: 没有 parent_run_id 或就是 top run → top message
    if (!parentRunId || runId === this.topRunId) {
      return this.topMessage;
    }

    // Case C: 已存在的 sub-message
    const existing = this.subMessages.get(runId);
    if (existing) return existing;

    // Case D: 新 sub-message（parent 必须是 topRunId 或者某个已知的 sub）
    const parent =
      parentRunId === this.topRunId
        ? this.topMessage
        : this.subMessages.get(parentRunId);
    if (!parent) {
      // parent 还没创建；这种情况是 AGNO 给的顺序有点不对劲，但保险起见：
      // 把它当成 top 的子（少数情况会丢掉嵌套层级，但至少不会消失）。
      const sub: ChatMessage = {
        id: generateIdPlaceholder(),
        role: "assistant",
        parts: [],
        status: "streaming",
        createdAt: Date.now(),
        runId,
        agentId: data.agent_id ?? undefined,
        teamId: data.team_id ?? undefined,
        parentMessageId: this.topMessage?.id ?? "",
        displayName: this.extractDisplayName(data),
      };
      this.subMessages.set(runId, sub);
      if (this.topMessage) {
        this.topMessage = {
          ...this.topMessage,
          subMessages: [...(this.topMessage.subMessages ?? []), sub],
        };
        // 也在 top.parts 末尾注入一个 marker，让 chip 出现在"team 内容流"的当前位置
        this.injectSubMarker(this.topMessage, sub);
        callbacks.onMessageUpdate(this.topMessage);
      }
      callbacks.onSubMessageCreated?.(this.topMessage?.id ?? "", sub);
      return sub;
    }

    // 正常路径：parent 已存在，创建 sub 挂上去
    const sub: ChatMessage = {
      id: generateIdPlaceholder(),
      role: "assistant",
      parts: [],
      status: "streaming",
      createdAt: Date.now(),
      runId,
      agentId: data.agent_id ?? undefined,
      teamId: data.team_id ?? undefined,
      parentMessageId: parent.id,
      displayName: this.extractDisplayName(data),
    };
    this.subMessages.set(runId, sub);

    parent.subMessages = [...(parent.subMessages ?? []), sub];

    // 把 marker 注入 parent 的 parts[] 末尾（"team 流到此处委派给 sub"）
    this.injectSubMarker(parent, sub);

    callbacks.onMessageUpdate(parent);
    callbacks.onSubMessageCreated?.(parent.id, sub);
    return sub;
  }

  /**
   * 把一个 sub_message_marker part 追加到指定父 message 的 parts[] 末尾。
   * 这样 chip 会出现在"team 自己的内容流"里 sub 启动的那一刻。
   */
  private injectSubMarker(parent: ChatMessage, sub: ChatMessage) {
    // 仅最外层注入 marker；嵌套 sub-of-sub 的渲染交给侧边栏内部
    if (parent !== this.topMessage) return;
    parent.parts.push({
      type: "sub_message_marker",
      subMessageId: sub.id,
    });
  }

  /**
   * 把单个 SSE event 归约到指定 target message 上
   */
  private applyEvent(
    target: ChatMessage,
    data: AgRunResponse,
    callbacks: ChatRunnerCallbacks
  ) {
    const eventName = data.event ?? data.status ?? "";

    switch (eventName) {
      case "RunStarted": {
        if (data.agent_id) target.agentId = data.agent_id;
        if (data.team_id) target.teamId = data.team_id;
        const nm = this.extractDisplayName(data);
        if (nm) target.displayName = nm;
        break;
      }

      case "RunContent":
      case "RunContentDelta": {
        const delta =
          data.delta ??
          (typeof data.content === "string" ? data.content : null);
        if (delta != null) {
          this.appendText(target, delta, callbacks);
        }
        break;
      }

      case "ReasoningContent":
      case "ReasoningContentDelta": {
        const reasoning = data.reasoning ?? data.delta ?? data.reasoning_content;
        if (reasoning != null) {
          this.appendReasoning(
            target,
            typeof reasoning === "string" ? reasoning : JSON.stringify(reasoning)
          );
        }
        break;
      }

      case "ReasoningStep":
      case "ReasoningStepDelta": {
        const step = data.reasoning_step;
        if (step) this.appendReasoningStep(target, step);
        break;
      }

      case "ToolCallStarted": {
        const tc = data.tool;
        if (tc) this.startToolCall(target, tc);
        break;
      }

      case "ToolCallCompleted":
      case "ToolCallResult": {
        const tc = data.tool;
        if (tc) this.completeToolCall(target, tc, data.tool_result);
        break;
      }

      case "ToolCallError": {
        const tc = data.tool;
        if (tc)
          this.errorToolCall(
            target,
            tc,
            (data.tool_result as string | undefined) ??
              data.error ??
              "tool error"
          );
        break;
      }

      case "RunReferences": {
        if (data.references?.length || data.citations?.length) {
          this.appendReferences(target, [
            ...(data.references ?? []),
            ...(data.citations ?? []),
          ]);
        }
        break;
      }

      case "RunPaused": {
        const pauseInfo = this.collectPauseInfo(target, data);
        if (pauseInfo) {
          target.awaitingInput = true;
          target.status = "paused";
          target.pauseInfo = pauseInfo;
          callbacks.onRunPaused?.(data.run_id ?? "", pauseInfo);
        }
        break;
      }

      case "RunCompleted": {
        if (data.metrics) target.metrics = data.metrics;
        if (target.status !== "paused") target.status = "completed";
        break;
      }

      case "RunError":
      case "RunCancelled": {
        if (eventName === "RunError") {
          const msg = data.error ?? data.content ?? "Agent run failed";
          target.status = "error";
          target.error = String(msg);
          target.parts.push({ type: "error", message: String(msg) });
        } else {
          if (target.status !== "paused") target.status = "cancelled";
        }
        break;
      }

      default: {
        // 兜底：尝试提取 content/reasoning_content/delta
        if (typeof data.delta === "string") {
          this.appendText(target, data.delta, callbacks);
        } else if (typeof data.content === "string" && data.content) {
          this.appendText(target, data.content, callbacks);
        } else if (typeof data.reasoning === "string") {
          this.appendReasoning(target, data.reasoning);
        } else if (data.tool) {
          const toolId = data.tool.tool_call_id ?? data.tool.id;
          if (!this.findToolCall(target, toolId))
            this.startToolCall(target, data.tool);
          else this.completeToolCall(target, data.tool, data.tool_result);
        }
      }
    }
  }

  private extractDisplayName(data: any): string | undefined {
    const nm =
      data.agent_name ??
      data.team_name ??
      data.member_name ??
      data?.extra_data?.agent_name;
    if (typeof nm === "string" && nm.trim()) return nm;
    if (data.agent_id) return String(data.agent_id);
    if (data.team_id) return String(data.team_id);
    return undefined;
  }

  private appendText(
    target: ChatMessage,
    delta: string,
    callbacks: ChatRunnerCallbacks
  ) {
    const parts = target.parts;
    const last = parts[parts.length - 1];
    if (last && last.type === "text") {
      parts[parts.length - 1] = { type: "text", text: last.text + delta };
    } else {
      parts.push({ type: "text", text: delta });
    }
    callbacks.onChunk?.(delta);
  }

  private appendReasoning(target: ChatMessage, text: string) {
    const parts = target.parts;
    const last = parts[parts.length - 1];
    if (last && last.type === "reasoning") {
      parts[parts.length - 1] = {
        type: "reasoning",
        text: last.text + text,
        steps: last.steps,
      };
    } else {
      parts.push({ type: "reasoning", text, steps: [] });
    }
  }

  private appendReasoningStep(
    target: ChatMessage,
    step: { title?: string; reasoning?: string; action?: string; result?: string }
  ) {
    const parts = target.parts;
    const last = parts[parts.length - 1];
    if (last && last.type === "reasoning") {
      parts[parts.length - 1] = {
        type: "reasoning",
        text: last.text,
        steps: [...(last.steps ?? []), step],
      };
    } else {
      parts.push({ type: "reasoning", text: "", steps: [step] });
    }
  }

  private findToolCall(target: ChatMessage, id: string): ToolCallPart | undefined {
    for (const p of target.parts) {
      if (p.type === "tool_call" && p.toolCallId === id) return p;
    }
    return undefined;
  }

  private startToolCall(target: ChatMessage, tc: AgToolCall) {
    if (!tc) return;
    const args = this.extractToolArgs(tc);
    target.parts.push({
      type: "tool_call",
      toolCallId: tc.tool_call_id ?? tc.id ?? `tc-${Date.now()}-${Math.random()}`,
      toolName: this.extractToolName(tc),
      args,
      status: "calling",
      startedAt: Date.now(),
    });
  }

  private completeToolCall(
    target: ChatMessage,
    tc: AgToolCall,
    result?: string
  ): void {
    if (!tc) return;
    const targetId = tc.tool_call_id ?? tc.id;
    let idx = target.parts.findIndex(
      (p) => p.type === "tool_call" && p.toolCallId === targetId
    );
    if (idx === -1) {
      this.startToolCall(target, tc);
      idx = target.parts.findIndex(
        (p) => p.type === "tool_call" && p.toolCallId === targetId
      );
      if (idx === -1) return;
    }
    this.applyCompleteToolCall(target, idx, tc, result);
  }

  private applyCompleteToolCall(
    target: ChatMessage,
    idx: number,
    tc: AgToolCall,
    result?: string
  ): void {
    const existing = target.parts[idx] as ToolCallPart;

    let resultValue: any = existing.result;
    const fromArgs = this.extractToolResult(tc);
    if (fromArgs !== undefined && fromArgs !== null) {
      resultValue = fromArgs;
    } else if (result != null) {
      resultValue = safeJsonParse(result, result);
    }

    const metrics = tc.metrics;
    target.parts[idx] = {
      ...existing,
      toolName:
        existing.toolName === "tool"
          ? this.extractToolName(tc)
          : existing.toolName,
      result: resultValue,
      status: tc.tool_call_error ? "error" : "completed",
      error: tc.tool_call_error
        ? String(resultValue ?? "tool error")
        : undefined,
      metrics,
      endedAt: Date.now(),
      durationMs:
        metrics?.duration != null
          ? Math.round(metrics.duration * 1000)
          : Date.now() - existing.startedAt,
    };
  }

  private errorToolCall(target: ChatMessage, tc: AgToolCall, error: string): void {
    if (!tc) return;
    const targetId = tc.tool_call_id ?? tc.id;
    let idx = target.parts.findIndex(
      (p) => p.type === "tool_call" && p.toolCallId === targetId
    );
    if (idx === -1) {
      this.startToolCall(target, tc);
      idx = target.parts.findIndex(
        (p) => p.type === "tool_call" && p.toolCallId === targetId
      );
      if (idx === -1) return;
    }
    const existing = target.parts[idx] as ToolCallPart;
    target.parts[idx] = {
      ...existing,
      error,
      status: "error",
      endedAt: Date.now(),
      durationMs: Date.now() - existing.startedAt,
    };
  }

  /**
   * 提取工具名 - 兼容多种 schema:
   * - AGNO: tc.tool_name
   * - OpenAI 风格: tc.function.name
   */
  private extractToolName(tc: any): string {
    if (tc.tool_name) return tc.tool_name;
    if (tc.function?.name) return tc.function.name;
    if (tc.name) return tc.name;
    return "tool";
  }

  /**
   * 提取工具参数 - 兼容多种 schema:
   * - AGNO: tc.tool_args (object)
   * - OpenAI 风格: tc.function.arguments (JSON string)
   */
  private extractToolArgs(tc: any): any {
    if (tc.tool_args !== undefined && tc.tool_args !== null) {
      return tc.tool_args;
    }
    if (tc.function?.arguments) {
      return safeJsonParse(tc.function.arguments, {});
    }
    if (tc.arguments) {
      return typeof tc.arguments === "string" ? safeJsonParse(tc.arguments, {}) : tc.arguments;
    }
    return {};
  }

  /**
   * 提取工具结果
   */
  private extractToolResult(tc: any): any {
    if (tc.result !== undefined && tc.result !== null) {
      return typeof tc.result === "string" ? safeJsonParse(tc.result, tc.result) : tc.result;
    }
    return null;
  }

  private appendReferences(target: ChatMessage, refs: any[]) {
    target.parts.push({
      type: "reference",
      references: refs.map((r) => ({
        title: r.title,
        url: r.url,
        excerpt: r.excerpt ?? r.cited_text,
        source: r.source,
        cited_text: r.cited_text,
      })),
    });
  }

  private collectPauseInfo(
    target: ChatMessage,
    data: AgRunResponse
  ): ChatMessage["pauseInfo"] | null {
    if (!data.run_id) return null;
    const toolCalls: any[] = [];
    for (const p of target.parts) {
      if (p.type === "tool_call" && p.status === "calling") {
        toolCalls.push({
          tool_call_id: p.toolCallId,
          tool_name: p.toolName,
          tool_args: p.args,
        });
      }
    }
    if (toolCalls.length === 0) return null;
    return { runId: data.run_id, toolCalls };
  }
}
