declare module "agno-chat" {
  import type { FC, ReactNode } from "react";

  export interface AgentSummary {
    id: string;
    name?: string;
    description?: string;
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

  export const ChatPanel: FC<ChatPanelProps>;
  export const AGNO_CHAT_VERSION: string;
  export class AgnoClient {
    constructor(opts: { baseUrl: string; token?: string | null });
    baseUrl: string;
  }
  export function buildToolResultIndex(runs: unknown[]): Map<string, string>;
  export function pickCommand(args: unknown): string | undefined;
  export function unwrapToolResult(result: unknown): unknown;
  export function isShellTool(toolName: string): boolean;
  export function pickShellOutput(result: unknown): unknown;
  export function truncateText(s: string, max: number): string;
}
