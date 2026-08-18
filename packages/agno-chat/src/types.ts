import type { ReactNode } from "react";
import type { AgSessionSummary, AgAgentResponse } from "./lib/agno-types";

export interface ChatPanelProps {
  baseUrl: string;
  agentId?: string;
  agents?: AgAgentResponse[];
  onAgentsChange?: (agents: AgAgentResponse[]) => void;
  auth?: { token?: string; headers?: Record<string, string> };
  theme?: AgnoChatTheme;
  showSessionList?: boolean;
  showReasoning?: boolean;
  showContextProgress?: boolean;
  briefToolCalls?: boolean;
  hideReasoning?: boolean;
  autoScroll?: boolean;
  userId?: string;
  onOpenExternalUrl?: (url: string) => void;
  onError?: (err: Error) => void;
  onSessionChange?: (sessionId: string | null) => void;
  /**
   * 触发探活 + 拉 agents 的回调（应用层接 `<ChatPanel>` 后负责实现）。
   * 未提供时，AgentPicker 的刷新按钮 disabled。
   */
  onRefreshAgents?: () => void;
  /**
   * CORS 修复一键改 /api 的回调（应用层负责 updateInstance + probe + loadAgents）。
   * 未提供时不渲染 CORS 一键修复按钮。
   */
  onFixCors?: () => void;
  /**
   * 当前实例的最小视图（id / baseUrl / lastAgentsError），传给 AgentPicker。
   */
  instanceInfo?: {
    id: string;
    baseUrl: string;
    lastAgentsError?: string | null;
  } | null;
  /** 当前实例是否正在加载 agents */
  loadingAgents?: boolean;
  slots?: ChatPanelSlots;
}

export interface AgnoChatTheme {
  accent?: string;
  accentFg?: string;
  radius?: string;
}

export interface ChatPanelSlots {
  header?: (ctx: { sessionName?: string }) => ReactNode;
  empty?: () => ReactNode;
  inputFooter?: () => ReactNode;
  userIdSetup?: ReactNode;
}

export type { AgSessionSummary, AgAgentResponse };