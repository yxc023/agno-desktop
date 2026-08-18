"use client";

import { useEffect } from "react";
import { ChatPanel as ChatPanelImpl } from "./components/chat/ChatPanel";
import { ApprovalDialog } from "./components/chat/ApprovalDialog";
import { SubAgentSidePanel } from "./components/chat/SubAgentSidePanel";
import { FilePreviewPanel } from "./components/chat/FilePreviewPanel";
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
  onRefreshAgents,
  onFixCors,
  instanceInfo,
  loadingAgents,
  slots,
}: ChatPanelProps) {
  useEffect(() => {
    const client = new AgnoClient({
      baseUrl,
      token: auth?.token,
    });

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
    };
  }, [baseUrl, auth?.token, agentId, userId]);

  return (
    <>
      <ChatPanelImpl
        agents={agents}
        onOpenExternalUrl={onOpenExternalUrl}
        autoScroll={autoScroll}
        hideReasoning={hideReasoning}
        briefToolCalls={briefToolCalls}
        userIdSetupSlot={slots?.userIdSetup}
        instanceInfo={instanceInfo ?? null}
        loadingAgents={loadingAgents}
        onRefreshAgents={onRefreshAgents}
        onFixCors={onFixCors}
        userId={userId ?? ""}
      />
      {/* 三个 singleton 由包内统一挂载，避免宿主应用重复 mount 导致双订阅/双渲染 */}
      <ApprovalDialog />
      <SubAgentSidePanel />
      <FilePreviewPanel />
    </>
  );
}