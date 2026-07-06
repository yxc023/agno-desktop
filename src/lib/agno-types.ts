/**
 * AGNO AgentOS API 类型定义
 * 基于 OpenAPI 3.1.0 spec（AGNO 2.6.x）
 *
 * 命名约定:
 * - `Ag*Response`    服务端直接返回的对象（OpenAPI 原始）
 * - `Ag*Request`     请求体
 * - `Ag*Event`       SSE 流式事件 payload
 */

export interface AgModelResponse {
  name?: string;
  model: string;
  provider: string;
}

export interface AgTool {
  name: string;
  description?: string;
  parameters?: Record<string, any>;
  requires_confirmation?: boolean;
  external_execution?: boolean;
}

export interface AgAgentSummary {
  id: string;
  name?: string;
  description?: string | null;
  db_id?: string | null;
  model?: string | AgModelResponse | null;
  metadata?: Record<string, any> | null;
}

export interface AgAgentResponse extends AgAgentSummary {
  role?: string | null;
  is_factory?: boolean;
  tools?: { tools?: AgTool[] } | null;
  sessions?: any;
  knowledge?: any;
  memory?: any;
  reasoning?: boolean | any;
  default_tools?: any;
  system_message?: string | null;
  extra_messages?: any;
  response_settings?: any;
  introduction?: string | null;
  streaming?: boolean;
  input_schema?: any;
  factory_input_schema?: any;
  is_component?: boolean;
  current_version?: number | null;
  stage?: string | null;
}

export interface AgTeamResponse extends AgAgentResponse {
  members?: AgAgentResponse[];
  mode?: "coordinate" | "route" | "broadcast" | "tasks";
}

export interface AgWorkflowResponse {
  id: string;
  name?: string;
  description?: string | null;
  steps?: any[];
  agent?: AgAgentResponse | null;
  team?: AgTeamResponse | null;
  is_factory?: boolean;
  factory_input_schema?: any;
  current_version?: number | null;
  stage?: string | null;
}

export interface AgInfoResponse {
  agno_version?: string;
  agent_count?: number;
  team_count?: number;
  workflow_count?: number;
}

export interface AgConfigResponse {
  os_id?: string;
  name?: string;
  description?: string;
  available_models?: AgModelResponse[];
  os_database?: string;
  databases?: any[];
  agents?: AgAgentResponse[];
  teams?: AgTeamResponse[];
  workflows?: AgWorkflowResponse[];
  chat?: { quick_prompts?: Record<string, string[]> };
  manifest?: {
    description?: string;
    labels?: Record<string, string>;
    quick_prompts?: Record<string, string[]>;
  };
  session?: any;
  metrics?: any;
  memory?: any;
  learning?: any;
  knowledge?: any;
  evals?: any;
  traces?: any;
  interfaces?: { type: string; version?: string; route?: string }[];
}

export interface AgHealthResponse {
  status: string;
  instantiated_at?: string | number;
}

export type AgRunStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "ERROR"
  | "PAUSED"
  | "CANCELLED"
  | "CONTINUED";

/** AGNO 的 tool 字段 schema (实际事件格式) */
export interface AgToolCall {
  tool_call_id: string;
  tool_name?: string;
  tool_args?: Record<string, any> | string;
  result?: string | null;
  tool_call_error?: boolean | string | null;
  metrics?: {
    duration?: number;
    [key: string]: any;
  };
  requires_confirmation?: boolean | null;
  confirmed?: boolean | null;
  confirmation_note?: string | null;
  created_at?: number;
  /** 兼容 OpenAI 风格的旧字段（如果出现） */
  id?: string;
  type?: string;
  function?: {
    name: string;
    arguments: string;
  };
}

export interface AgReasoningStep {
  title?: string;
  reasoning?: string;
  action?: string;
  result?: string;
  confidence?: number;
}

export interface AgReference {
  title?: string;
  url?: string;
  excerpt?: string;
  source?: string;
  [key: string]: any;
}

export interface AgCitation {
  url?: string;
  title?: string;
  excerpt?: string;
  cited_text?: string;
}

export interface AgMessageMetrics {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  duration?: number;
  time_to_first_token?: number;
}

export interface AgChatMessage {
  id?: string;
  role: "user" | "assistant" | "system" | "tool" | "developer" | "reasoning";
  content?: string | any;
  name?: string;
  tool_call_id?: string;
  tool_calls?: AgToolCall[];
  error?: string;
  metrics?: AgMessageMetrics;
  images?: any[];
  videos?: any[];
  audio?: any[];
  files?: any[];
  [key: string]: any;
}

export interface AgRunResponse {
  run_id: string;
  parent_run_id?: string | null;
  session_id?: string;
  agent_id?: string;
  team_id?: string;
  workflow_id?: string;
  user_id?: string;
  status: AgRunStatus;
  run_input?: any;
  content?: string | Record<string, any>;
  content_type?: string;
  run_response_format?: string;
  reasoning_content?: string;
  reasoning_steps?: AgReasoningStep[];
  reasoning_messages?: any[];
  messages?: AgChatMessage[];
  tools?: AgTool[];
  events?: any[];

  /** AGNO 在 run 级持久化的 agent 标识 (e.g. "CodeSearch") — 用于判断 events[] 里哪个 agent_name 是"外层" */
  agent_name?: string;
  metrics?: AgMessageMetrics;
  references?: AgReference[];
  citations?: AgCitation[];
  images?: any[];
  videos?: any[];
  audio?: any[];
  files?: any[];
  response_audio?: any;
  input_media?: any;
  followups?: string[];
  session_state?: Record<string, any>;
  created_at?: number;
  extra_data?: Record<string, any>;
  step_results?: any[];
  step_executor_runs?: any[];
  step_requirements?: any[];
  pause_kind?: "step" | "executor" | null;
  paused_step_name?: string | null;
  paused_step_index?: number | null;

  /** 流式事件字段 */
  event?: string;
  delta?: string;
  tool?: AgToolCall;
  tool_call_id?: string;
  tool_name?: string;
  tool_args?: string;
  tool_result?: string;
  reasoning?: string;
  reasoning_step?: AgReasoningStep;
  content_index?: number;
  event_index?: number;
  error?: string;
}

/**
 * AGNO Trace / Span model (类型保留备用；当前 loadHistory 不直接调用 /traces）
 *
 * Sub-agent 历史通过 runs[i].events[] 直接重建，不需要额外的 trace API。
 * 这套类型仅作为 AGNO 数据形状的参考文档；如未来需要走 /traces 端点
 * （例如查 team 嵌套），可以解开注释直接用。
 */
// export type AgSpanType = "AGENT" | "LLM" | "TOOL" | "TEAM" | "WORKFLOW";
// export interface AgSpan { ... }
// export interface AgTrace { ... }
// export interface AgPaginatedTracesResponse { ... }

export interface AgApproval {
  id: string;
  run_id: string;
  session_id?: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  source_type: "agent" | "team" | "workflow";
  approval_type?: string;
  pause_type?: string;
  tool_name?: string;
  tool_args?: any;
  requirements?: any[];
  context?: Record<string, any>;
  resolution_data?: any;
  resolved_by?: string;
  resolved_at?: number;
  expires_at?: number;
  agent_id?: string;
  team_id?: string;
  workflow_id?: string;
  user_id?: string;
  source_name?: string;
  run_status?: AgRunStatus;
}

export interface AgSessionSummary {
  session_id: string;
  session_name?: string | null;
  session_state?: Record<string, any>;
  created_at?: number;
  updated_at?: number;
  session_type: "agent" | "team" | "workflow";
  user_id?: string;
  agent_id?: string;
  team_id?: string;
  workflow_id?: string;
  session_summary?: string | null;
  metrics?: AgMessageMetrics;
  total_tokens?: number;
  metadata?: Record<string, any> | null;
  runs_count?: number;
  message_count?: number;
  last_message_preview?: string;
}

export interface AgSessionDetail extends AgSessionSummary {
  chat_history?: AgChatMessage[];
  agent_data?: AgAgentResponse;
  team_data?: AgTeamResponse;
  workflow_data?: AgWorkflowResponse;
}

export interface AgPaginatedResponse<T> {
  data: T[];
  meta?: {
    page?: number;
    limit?: number;
    total_pages?: number;
    total_count?: number;
  };
}

export interface AgCreateSessionRequest {
  session_id?: string;
  agent_id?: string;
  team_id?: string;
  workflow_id?: string;
  user_id?: string;
  session_name?: string;
  session_state?: Record<string, any>;
  metadata?: Record<string, any>;
  extra_data?: Record<string, any>;
}

export interface AgRunAgentRequest {
  message: string;
  stream?: boolean;
  session_id?: string | null;
  user_id?: string | null;
  files?: File[];
  version?: string | null;
  background?: boolean;
  factory_input?: Record<string, any> | null;
}

export interface AgContinueRunRequest {
  tools?: Array<{
    tool_call_id: string;
    content: string;
  }>;
  session_id?: string | null;
  user_id?: string | null;
  stream?: boolean;
  background?: boolean;
}

export interface AgResumeRunRequest {
  last_event_index?: number | null;
  session_id?: string | null;
}

export interface AgApprovalResolveRequest {
  status: "APPROVED" | "REJECTED";
  resolved_by?: string;
  resolution_data?: any;
}

export interface AgMemory {
  memory_id: string;
  memory: string;
  topics?: string[];
  agent_id?: string;
  team_id?: string;
  user_id?: string;
  updated_at?: number;
}