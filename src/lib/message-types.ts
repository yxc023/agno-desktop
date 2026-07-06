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
  | ErrorPart
  | SubMessageMarker;

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

/**
 * 内嵌在 message.parts[] 里的"子 agent 占位"。
 *
 * 出现一个 marker 即代表"在这一位置/这一刻，team 把发言权交给了某个 sub-agent"；
 * UI 渲染时把它替换成一个紧凑的 chip（点击进入右侧抽屉），而不是直接展开内容。
 *
 * marker 本身可以保证串行播放顺序：sub-agent 内容另存于
 * `ChatMessage.subMessages[]`，marker 的 `subMessageId` 引用 sub.id。
 */
export interface SubMessageMarker {
  type: "sub_message_marker";
  subMessageId: string;
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
  /** AGNO team_id（sub-message 来自 team member 时） */
  teamId?: string;
  /**
   * 子 agent 产出的内容，用于 team / multi-agent 场景
   *
   * - 当父 message 是 team 时，team 委派给 member agent，
   *   member agent 自己的 reasoning / tool_calls / 文本会进入一个独立的 ChatMessage，
   *   挂载到父 message 的 `subMessages[]` 上。
   * - 嵌套多层也用同一个 `subMessages`，sub 之下可以有 sub-sub。
   */
  subMessages?: ChatMessage[];
  /** 这个 message 嵌套在哪个父 message 下（仅对子 message 有效；和嵌套结构等价的扁平索引）。 */
  parentMessageId?: string;
  /** 显示用的名字（用于 sub-agent 块的 header），从 data.agent_name 或 instances-store 解析得到。 */
  displayName?: string;
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