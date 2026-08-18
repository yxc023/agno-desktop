import type { ReactNode } from "react";
import type { AgSessionSummary } from "./lib/agno-types";

export interface ChatPanelProps {
  baseUrl: string;
  agentId?: string;
  agents?: AgentSummary[];
  onAgentsChange?: (agents: AgentSummary[]) => void;
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

export interface AgentSummary {
  id: string;
  name?: string;
  description?: string;
}

export type { AgSessionSummary };
