/**
 * ChatRunner: 把 AGNO SSE 流归约为 ChatMessage 状态
 *
 * 设计:
 * - 每个 ChatRunner 实例对应一次"run"（不是整个 session）
 * - 持有 AbortController 用于取消
 * - 把 event 派发到 reducer，更新 messages[] 中的目标 message
 */

import { AgnoClient } from "./agno-client";
import type { AgRunResponse, AgToolCall } from "./agno-types";
import {
  type ChatMessage,
  type MessagePart,
  type ToolCallPart,
  type ToolCallStatus,
  generateIdPlaceholder,
} from "./message-types-helpers";
import { parseSSEData } from "./sse-parser";
import { safeJsonParse } from "./utils";

export interface ChatRunnerCallbacks {
  onMessageUpdate: (message: ChatMessage) => void;
  onRunStarted?: (runId: string, sessionId?: string) => void;
  onRunCompleted?: (runId: string, message: ChatMessage) => void;
  onRunError?: (runId: string, error: string) => void;
  onRunPaused?: (runId: string, info: ChatMessage["pauseInfo"]) => void;
  onChunk?: (text: string) => void;
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
  private currentRunId: string | null = null;
  private currentSessionId: string | null = null;
  private currentMessage: ChatMessage | null = null;
  private currentAgentId: string | null = null;

  isRunning() {
    return this.abortController !== null;
  }

  getCurrentRunId() {
    return this.currentRunId;
  }

  getCurrentSessionId() {
    return this.currentSessionId;
  }

  getCurrentMessage() {
    return this.currentMessage;
  }

  abort() {
    this.abortController?.abort();
    this.abortController = null;
    if (this.currentMessage) {
      this.currentMessage = {
        ...this.currentMessage,
        status: this.currentMessage.parts.some((p) => p.type === "tool_call" && p.status === "calling")
          ? "paused"
          : "cancelled",
      };
    }
  }

  async run(params: RunAgentParams, callbacks: ChatRunnerCallbacks): Promise<void> {
    this.abortController = new AbortController();
    this.currentAgentId = params.agentId;

    const existing = params.existingAssistantMessage;
    this.currentMessage = existing ?? {
      id: generateIdPlaceholder(),
      role: "assistant",
      parts: [],
      status: "streaming",
      createdAt: Date.now(),
      agentId: params.agentId,
    };
    if (params.sessionId) this.currentMessage.sessionId = params.sessionId;
    callbacks.onMessageUpdate(this.currentMessage);

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

        // 跟踪 run_id / session_id
        if (data.run_id && !this.currentRunId) {
          this.currentRunId = data.run_id;
          this.currentMessage.runId = data.run_id;
          if (data.session_id) {
            this.currentSessionId = data.session_id;
            this.currentMessage.sessionId = data.session_id;
          }
          callbacks.onRunStarted?.(data.run_id, data.session_id);
        } else if (data.session_id && !this.currentSessionId) {
          this.currentSessionId = data.session_id;
          this.currentMessage.sessionId = data.session_id;
        }

        this.applyEvent(data, callbacks);

        if (this.currentMessage) {
          callbacks.onMessageUpdate(this.currentMessage);
        }
      }

      if (this.currentMessage) {
        const finalStatus = this.currentMessage.status;
        if (finalStatus === "streaming") {
          this.currentMessage.status =
            this.currentMessage.parts.length === 0 ? "completed" : "completed";
        }
        callbacks.onMessageUpdate(this.currentMessage);
        callbacks.onRunCompleted?.(this.currentRunId ?? "", this.currentMessage);
      }
    } catch (err) {
      if (this.abortController.signal.aborted) {
        // 主动取消
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (this.currentMessage) {
        this.currentMessage = {
          ...this.currentMessage,
          status: "error",
          error: msg,
          parts: [
            ...this.currentMessage.parts,
            { type: "error", message: msg },
          ],
        };
        callbacks.onMessageUpdate(this.currentMessage);
      }
      callbacks.onRunError?.(this.currentRunId ?? "", msg);
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
    this.currentAgentId = params.agentId;
    this.currentRunId = params.runId;
    this.currentSessionId = params.sessionId ?? null;

    if (this.currentMessage) {
      this.currentMessage.status = "streaming";
      this.currentMessage.awaitingInput = false;
      callbacks.onMessageUpdate(this.currentMessage);
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
        this.applyEvent(data, callbacks);
        if (this.currentMessage) callbacks.onMessageUpdate(this.currentMessage);
      }

      if (this.currentMessage) {
        this.currentMessage.status = "completed";
        callbacks.onMessageUpdate(this.currentMessage);
        callbacks.onRunCompleted?.(params.runId, this.currentMessage);
      }
    } catch (err) {
      if (this.abortController.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (this.currentMessage) {
        this.currentMessage = {
          ...this.currentMessage,
          status: "error",
          error: msg,
          parts: [
            ...this.currentMessage.parts,
            { type: "error", message: msg },
          ],
        };
        callbacks.onMessageUpdate(this.currentMessage);
      }
      callbacks.onRunError?.(params.runId, msg);
    } finally {
      this.abortController = null;
    }
  }

  /**
   * 把单个 SSE event 归约到 currentMessage 上
   */
  private applyEvent(data: AgRunResponse, callbacks: ChatRunnerCallbacks) {
    if (!this.currentMessage) return;
    const parts = this.currentMessage.parts;
    const eventName = data.event ?? data.status ?? "";

    switch (eventName) {
      case "RunStarted":
      case "RunContent":
      case "RunContentDelta": {
        // 文本增量
        const delta =
          data.delta ??
          (typeof data.content === "string" ? data.content : null);
        if (delta != null) {
          this.appendText(delta, callbacks);
        }
        break;
      }

      case "ReasoningContent":
      case "ReasoningContentDelta": {
        const reasoning = data.reasoning ?? data.delta ?? data.reasoning_content;
        if (reasoning != null) {
          this.appendReasoning(typeof reasoning === "string" ? reasoning : JSON.stringify(reasoning));
        }
        break;
      }

      case "ReasoningStep":
      case "ReasoningStepDelta": {
        const step = data.reasoning_step;
        if (step) this.appendReasoningStep(step);
        break;
      }

      case "ToolCallStarted": {
        const tc = data.tool;
        if (tc) this.startToolCall(tc);
        break;
      }

      case "ToolCallCompleted":
      case "ToolCallResult": {
        const tc = data.tool;
        if (tc) this.completeToolCall(tc, data.tool_result);
        break;
      }

      case "ToolCallError": {
        const tc = data.tool;
        if (tc) this.errorToolCall(tc, data.tool_result ?? data.error ?? "tool error");
        break;
      }

      case "RunReferences": {
        if (data.references?.length || data.citations?.length) {
          this.appendReferences([
            ...(data.references ?? []),
            ...(data.citations ?? []),
          ]);
        }
        break;
      }

      case "RunPaused": {
        // 解析待执行的 tool calls
        const pauseInfo = this.collectPauseInfo(data);
        if (pauseInfo) {
          this.currentMessage.awaitingInput = true;
          this.currentMessage.status = "paused";
          this.currentMessage.pauseInfo = pauseInfo;
          callbacks.onRunPaused?.(data.run_id ?? "", pauseInfo);
        }
        break;
      }

      case "RunCompleted": {
        if (data.metrics) this.currentMessage.metrics = data.metrics;
        this.currentMessage.status = "completed";
        break;
      }

      case "RunError":
      case "RunCancelled": {
        if (eventName === "RunError") {
          const msg = data.error ?? data.content ?? "Agent run failed";
          this.currentMessage.status = "error";
          this.currentMessage.error = String(msg);
          parts.push({ type: "error", message: String(msg) });
        } else {
          this.currentMessage.status = "cancelled";
        }
        break;
      }

      default: {
        // 兜底：尝试提取 content/reasoning_content/delta
        if (typeof data.delta === "string") {
          this.appendText(data.delta, callbacks);
        } else if (typeof data.content === "string" && data.content) {
          // 兼容：有些实现一次性推送完整 content
          this.appendText(data.content, callbacks);
        } else if (typeof data.reasoning === "string") {
          this.appendReasoning(data.reasoning);
        } else if (data.tool) {
          // 有些实现只发 tool 事件，没有 ToolCallStarted
          const toolId = (data.tool as any).tool_call_id ?? (data.tool as any).id;
          if (!this.findToolCall(toolId)) this.startToolCall(data.tool);
          else this.completeToolCall(data.tool, data.tool_result);
        }
      }
    }
  }

  private appendText(delta: string, callbacks: ChatRunnerCallbacks) {
    if (!this.currentMessage) return;
    const parts = this.currentMessage.parts;
    const last = parts[parts.length - 1];
    if (last && last.type === "text") {
      parts[parts.length - 1] = { type: "text", text: last.text + delta };
    } else {
      parts.push({ type: "text", text: delta });
    }
    callbacks.onChunk?.(delta);
  }

  private appendReasoning(text: string) {
    if (!this.currentMessage) return;
    const parts = this.currentMessage.parts;
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

  private appendReasoningStep(step: { title?: string; reasoning?: string; action?: string; result?: string }) {
    if (!this.currentMessage) return;
    const parts = this.currentMessage.parts;
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

  private findToolCall(id: string): ToolCallPart | undefined {
    if (!this.currentMessage) return undefined;
    for (const p of this.currentMessage.parts) {
      if (p.type === "tool_call" && p.toolCallId === id) return p;
    }
    return undefined;
  }

  private startToolCall(tc: AgToolCall) {
    if (!this.currentMessage || !tc) return;
    const args = this.extractToolArgs(tc);
    this.currentMessage.parts.push({
      type: "tool_call",
      toolCallId: tc.tool_call_id ?? tc.id ?? `tc-${Date.now()}-${Math.random()}`,
      toolName: this.extractToolName(tc),
      args,
      status: "calling",
      startedAt: Date.now(),
    });
  }

  private completeToolCall(tc: AgToolCall, result?: string): void {
    if (!this.currentMessage || !tc) return;
    const targetId = tc.tool_call_id ?? tc.id;
    let idx = this.currentMessage.parts.findIndex(
      (p) => p.type === "tool_call" && p.toolCallId === targetId
    );
    if (idx === -1) {
      this.startToolCall(tc);
      idx = this.currentMessage.parts.findIndex(
        (p) => p.type === "tool_call" && p.toolCallId === targetId
      );
      if (idx === -1) return;
    }
    this.applyCompleteToolCall(idx, tc, result);
  }

  private applyCompleteToolCall(idx: number, tc: AgToolCall, result?: string): void {
    if (!this.currentMessage) return;
    const existing = this.currentMessage.parts[idx] as ToolCallPart;

    let resultValue: any = existing.result;
    const fromArgs = this.extractToolResult(tc);
    if (fromArgs !== undefined && fromArgs !== null) {
      resultValue = fromArgs;
    } else if (result != null) {
      resultValue = safeJsonParse(result, result);
    }

    const metrics = (tc as any).metrics;
    this.currentMessage.parts[idx] = {
      ...existing,
      toolName: existing.toolName === "tool" ? this.extractToolName(tc) : existing.toolName,
      result: resultValue,
      status: (tc as any).tool_call_error ? "error" : "completed",
      error: (tc as any).tool_call_error ? String(resultValue ?? "tool error") : undefined,
      metrics,
      endedAt: Date.now(),
      durationMs:
        metrics?.duration != null
          ? Math.round(metrics.duration * 1000)
          : Date.now() - existing.startedAt,
    };
  }

  private errorToolCall(tc: AgToolCall, error: string): void {
    if (!this.currentMessage || !tc) return;
    const targetId = tc.tool_call_id ?? tc.id;
    let idx = this.currentMessage.parts.findIndex(
      (p) => p.type === "tool_call" && p.toolCallId === targetId
    );
    if (idx === -1) {
      this.startToolCall(tc);
      idx = this.currentMessage.parts.findIndex(
        (p) => p.type === "tool_call" && p.toolCallId === targetId
      );
      if (idx === -1) return;
    }
    const existing = this.currentMessage.parts[idx] as ToolCallPart;
    this.currentMessage.parts[idx] = {
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

  private appendReferences(refs: any[]) {
    if (!this.currentMessage) return;
    this.currentMessage.parts.push({
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

  private collectPauseInfo(data: AgRunResponse): ChatMessage["pauseInfo"] | null {
    if (!this.currentMessage || !data.run_id) return null;
    const toolCalls: any[] = [];
    for (const p of this.currentMessage.parts) {
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