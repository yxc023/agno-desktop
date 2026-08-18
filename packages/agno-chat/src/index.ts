export const AGNO_CHAT_VERSION = "0.0.0";

export { ChatPanel } from "./ChatPanel";

export type {
  ChatPanelProps,
  AgnoChatTheme,
  ChatPanelSlots,
  AgAgentResponse,
  AgSessionSummary,
} from "./types";

export { AgnoClient } from "./lib/agno-client";
export {
  pickCommand,
  unwrapToolResult,
  isShellTool,
  pickShellOutput,
  truncateText,
} from "./lib/tool-render-utils";

export {
  useChatStore,
  buildToolResultIndex,
  useCurrentSessionMessages,
  useSubMessageById,
  useLatestInputTokens,
  useLatestOutputTokens,
  useLatestModelId,
} from "./stores/chat-store";

export { useSessionsStore, useCurrentAgentSessions } from "./stores/sessions-store";

export {
  useUIStore,
  tabsForSession,
  useActiveFileTab,
  findInTree,
  type FilePreviewTab,
} from "./stores/ui-store";

export {
  useSettingsStore,
  resolveTheme,
  type Settings,
  type Theme,
} from "./stores/settings-store";

export { ApprovalDialog } from "./components/chat/ApprovalDialog";
export { SubAgentSidePanel } from "./components/chat/SubAgentSidePanel";
export { FilePreviewPanel } from "./components/chat/FilePreviewPanel";