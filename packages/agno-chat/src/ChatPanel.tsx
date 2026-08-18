import { ChatPanel as ChatPanelImpl } from "./components/chat/ChatPanel";
import type { ChatPanelProps } from "./types";

export function ChatPanel(props: ChatPanelProps) {
  return <ChatPanelImpl {...props} />;
}