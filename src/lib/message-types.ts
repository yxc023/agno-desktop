/**
 * 前端统一的"消息片段"类型
 * ChatRunner 把 SSE 事件归约为这些结构，UI 直接渲染
 */

export type MessagePart =
  | TextPart
  | ReasoningPart
  | ToolCallPart
  | ReferencePart
  | ImagePart
  | AudioPart
  | VideoPart
  | ErrorPart;

export interface TextPart {
  type: "text";
  text: string;
}

export interface ReasoningPart {
  type: "reasoning";
  text: string;
  steps?: Array<{
    title?: string;
    reasoning?: string;
    action?: string;
    result?: string;
  }>;
}

export type ToolCallStatus = "calling" | "completed" | "error";

export interface ToolCallPart {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  args: any;
  result?: any;
  error?: string;
  status: ToolCallStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  metrics?: {
    duration?: number;
    [key: string]: any;
  };
}

export interface ReferencePart {
  type: "reference";
  references: Array<{
    title?: string;
    url?: string;
    excerpt?: string;
    source?: string;
    cited_text?: string;
  }>;
}

export interface ImagePart {
  type: "image";
  url: string;
  alt?: string;
}

export interface AudioPart {
  type: "audio";
  url: string;
  mimeType?: string;
}

export interface VideoPart {
  type: "video";
  url: string;
}

export interface ErrorPart {
  type: "error";
  message: string;
  details?: string;
}

export type MessageRole = "user" | "assistant" | "system";

export type MessageStatus =
  | "idle"
  | "streaming"
  | "completed"
  | "error"
  | "cancelled"
  | "paused";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  parts: MessagePart[];
  status: MessageStatus;
  createdAt: number;
  /** AGNO run_id */
  runId?: string;
  /** AGNO session_id */
  sessionId?: string;
  /** AGNO agent_id */
  agentId?: string;
  /** 是否需要 HITL（agent 暂停） */
  awaitingInput?: boolean;
  /** 暂停原因 / 所需工具执行结果 */
  pauseInfo?: {
    runId: string;
    toolCalls: Array<{
      tool_call_id: string;
      tool_name: string;
      tool_args: any;
    }>;
  };
  /** token 使用情况 */
  metrics?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    duration?: number;
  };
  error?: string;
}

export interface SessionMeta {
  sessionId: string;
  sessionName?: string | null;
  sessionType: "agent" | "team" | "workflow";
  agentId?: string;
  teamId?: string;
  workflowId?: string;
  userId?: string;
  createdAt?: number;
  updatedAt?: number;
  preview?: string;
}