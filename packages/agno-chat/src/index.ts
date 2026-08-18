export const AGNO_CHAT_VERSION = "0.0.0";

export { ChatPanel } from "./ChatPanel";

export type {
  ChatPanelProps,
  AgnoChatTheme,
  ChatPanelSlots,
  AgentSummary,
} from "./types";

export { AgnoClient } from "./lib/agno-client";
export { resolveToolRender } from "./lib/tool-render-utils";

// Internal store re-exports for app shim. These will be removed in Task 12
// once the stores are parameterized.
export {
  useChatStore,
  buildToolResultIndex,
  useCurrentSessionMessages,
  useSubMessageById,
  useLatestInputTokens,
  useLatestOutputTokens,
  useLatestModelId,
} from "./stores/chat-store";