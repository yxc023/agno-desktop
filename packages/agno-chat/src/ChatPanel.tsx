"use client";

import { useEffect, useRef } from "react";
import { ChatPanel as ChatPanelImpl } from "./components/chat/ChatPanel";
import { AgnoClient } from "./lib/agno-client";
import { useChatStore } from "./stores/chat-store";
import { useSessionsStore } from "./stores/sessions-store";
import type { ChatPanelProps } from "./types";

export function ChatPanel({
  baseUrl,
  agentId,
  agents,
  auth,
  userId,
  onOpenExternalUrl,
  autoScroll,
  hideReasoning,
  briefToolCalls,
  slots,
}: ChatPanelProps) {
  const clientRef = useRef<AgnoClient | null>(null);

  useEffect(() => {
    const client = new AgnoClient({
      baseUrl,
      token: auth?.token,
    });
    clientRef.current = client;

    useChatStore.getState().setContext({
      client,
      agentId: agentId ?? "",
      userId: userId ?? "",
    });
    useSessionsStore.getState().setContext({
      client,
      agentId: agentId ?? "",
      userId: userId ?? "",
    });

    return () => {
      useChatStore.getState().clearContext();
      useSessionsStore.getState().clearContext();
      clientRef.current = null;
    };
  }, [baseUrl, auth?.token, agentId, userId]);

  return (
    <ChatPanelImpl
      agents={agents}
      onOpenExternalUrl={onOpenExternalUrl}
      autoScroll={autoScroll}
      hideReasoning={hideReasoning}
      briefToolCalls={briefToolCalls}
      userIdSetupSlot={slots?.userIdSetup}
    />
  );
}
