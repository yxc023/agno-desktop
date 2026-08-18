import { useCallback, useEffect } from "react";
import {
  ArrowDown,
  Loader2,
  Plus,
  Cpu,
  Globe,
  Terminal,
} from "lucide-react";
import { VirtualMessageList } from "./VirtualMessageList";
import { MessageInput } from "./MessageInput";
import { ContextProgressBar } from "./ContextProgressBar";
import { useChatStore, useCurrentSessionMessages, useLatestInputTokens, useLatestModelId } from "../../stores/chat-store";
import { useSessionsStore } from "../../stores/sessions-store";
import { useAutoScroll } from "../../hooks/use-auto-scroll";
import { useHashScroll, writeMessageHash } from "../../hooks/use-hash-scroll";
import { clearAllShadows } from "../../lib/chat-buffer";
import { cn } from "../../lib/utils";
import type { AgAgentResponse } from "../../lib/agno-types";

const EXAMPLE_PROMPTS = [
  {
    icon: Globe,
    title: "搜索最新资讯",
    desc: "试试 web-search agent",
    prompt: "Search the latest Anthropic news from this week. Summarize one headline.",
  },
  {
    icon: Cpu,
    title: "代码库问答",
    desc: "试试 code-search agent",
    prompt: "What's the main entry point of this codebase?",
  },
  {
    icon: Terminal,
    title: "自由提问",
    desc: "任何你想问的",
    prompt: "用一句话介绍你自己能做什么。",
  },
];

export interface ChatPanelImplProps {
  agents?: AgAgentResponse[];
  onAgentsChange?: (agents: AgAgentResponse[]) => void;
  onOpenExternalUrl?: (url: string) => void;
  autoScroll?: boolean;
  hideReasoning?: boolean;
  briefToolCalls?: boolean;
  userIdSetupSlot?: React.ReactNode;
  /** 当前实例的简化视图（id / baseUrl / lastAgentsError） */
  instanceInfo?: {
    id: string;
    baseUrl: string;
    lastAgentsError?: string | null;
  } | null;
  /** 当前实例是否正在加载 agents */
  loadingAgents?: boolean;
  /** 触发探活 + 拉 agents 的回调（由宿主应用注入） */
  onRefreshAgents?: () => void;
  /** CORS 修复一键改 /api 的回调 */
  onFixCors?: () => void;
  /** user_id（空串 = 未设置） */
  userId?: string;
  slots?: {
    header?: React.ReactNode;
    empty?: React.ReactNode;
    inputFooter?: React.ReactNode;
  };
}

function ChatButton({
  variant,
  size,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "ghost" | "outline" | "secondary";
  size?: "default" | "sm" | "lg" | "icon" | "icon-sm";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        variant === "default" && "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/95",
        variant === "outline" && "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        variant === "secondary" && "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        variant === "ghost" && "hover:bg-accent hover:text-accent-foreground",
        !variant && "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        size === "sm" && "h-8 rounded-md px-3 text-xs",
        size === "lg" && "h-10 rounded-md px-6",
        size === "icon" && "h-9 w-9",
        size === "icon-sm" && "h-7 w-7",
        (!size || size === "default") && "h-9 px-4 py-2",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function ChatSkeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export function ChatPanel({
  agents = [],
  autoScroll: autoScrollEnabled = true,
  userIdSetupSlot,
  instanceInfo,
  loadingAgents = false,
  onRefreshAgents,
  onFixCors,
  userId = "",
  slots,
}: ChatPanelImplProps) {
  const currentSessionId = useSessionsStore((s) => s.currentSessionId);
  const messages = useCurrentSessionMessages(currentSessionId);
  const currentInputTokens = useLatestInputTokens(currentSessionId);
  const currentModelId = useLatestModelId(currentSessionId);
  const loadingHistory = useChatStore((s) =>
    currentSessionId ? s.loadingHistoryBySession[currentSessionId] ?? false : false
  );
  const loadedHistory = useChatStore((s) =>
    currentSessionId ? s.loadedHistoryBySession[currentSessionId] ?? false : false
  );
  const loadHistory = useChatStore((s) => s.loadHistory);
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const setSelectedAgent = useChatStore((s) => s.setSelectedAgent);
  const newSession = useChatStore((s) => s.newSession);
  const sendMessage = useChatStore((s) => s.sendMessage);

  const {
    scrollRef,
    stickToBottom,
    jumpToBottom,
    pause: pauseAutoScroll,
    onScroll,
    onWheel,
  } = useAutoScroll({ enabled: autoScrollEnabled });

  const hashTargetId = useHashScroll();

  useEffect(() => {
    return () => {
      clearAllShadows();
    };
  }, []);

  useEffect(() => {
    if (hashTargetId) pauseAutoScroll();
  }, [hashTargetId, pauseAutoScroll]);

  useEffect(() => {
    if (currentSessionId) {
      const loaded = useChatStore.getState().loadedHistoryBySession[currentSessionId];
      const loading = useChatStore.getState().loadingHistoryBySession[currentSessionId];
      if (!loaded && !loading) {
        loadHistory(currentSessionId);
      }
    }
  }, [currentSessionId, loadHistory]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (hashTargetId) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight });
    });
  }, [currentSessionId, loadedHistory, hashTargetId]);

  const handleActiveMessageChange = useCallback((id: string | null) => {
    if (!id) return;
    writeMessageHash(id, { silent: true });
  }, []);

  const selectedAgent =
    agents.find((a) => a.id === selectedAgentId) ?? agents[0] ?? null;

  return (
    <div className="flex h-full flex-col">
      {slots?.header ?? (
        <div className="flex h-10 shrink-0 items-center justify-end gap-2 border-b border-border bg-background/60 px-4 backdrop-blur-sm">
          <ContextProgressBar
            currentTokens={currentInputTokens}
            agent={selectedAgent}
            modelId={currentModelId}
          />
          <ChatButton
            variant="ghost"
            size="sm"
            onClick={() => newSession(selectedAgentId ?? undefined)}
            className="h-7 font-mono text-[11px]"
          >
            <Plus className="h-3 w-3" />
            <span>new</span>
          </ChatButton>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onWheel={onWheel}
          className="absolute inset-0 overflow-y-auto overscroll-y-contain"
        >
          {currentSessionId && messages.length > 0 ? (
            <div className="mx-auto max-w-4xl py-6">
              <VirtualMessageList
                key={currentSessionId}
                messages={messages}
                scrollRef={scrollRef}
                loadingHistory={loadingHistory}
                cacheKey={currentSessionId}
                scrollToMessageId={hashTargetId ?? undefined}
                onActiveMessageChange={handleActiveMessageChange}
              />
            </div>
          ) : currentSessionId && (loadingHistory || !loadedHistory) ? (
            <ChatHistorySkeleton />
          ) : (
            <ChatEmptyState
              agentName={
                agents.find((a) => a.id === selectedAgentId)?.name ??
                selectedAgentId ??
                agents[0]?.name
              }
              onPrompt={(p) => {
                if (!selectedAgentId && agents[0]) {
                  setSelectedAgent(agents[0].id);
                }
                sendMessage({ text: p });
              }}
              onNewSession={() => {
                newSession(selectedAgentId ?? undefined);
              }}
            />
          )}
        </div>

        {!stickToBottom && messages.length > 0 && (
          <ChatButton
            variant="outline"
            size="icon-sm"
            onClick={() => jumpToBottom(true)}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-lg bg-card/95 backdrop-blur-sm border-border"
          >
            <ArrowDown className="h-3 w-3" />
          </ChatButton>
        )}
      </div>

      {currentSessionId && (
        <>
          <MessageInput
            instance={instanceInfo ?? null}
            agents={agents ?? []}
            loadingAgents={loadingAgents}
            onRefreshAgents={onRefreshAgents ?? (() => {})}
            onFixCors={onFixCors}
            userId={userId}
          />
          {slots?.inputFooter}
        </>
      )}

      {userIdSetupSlot}
    </div>
  );
}

function ChatHistorySkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground/70">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>loading history…</span>
      </div>
      <div className="flex justify-end">
        <ChatSkeleton className="h-9 w-[55%]" />
      </div>
      <div className="space-y-3">
        <ChatSkeleton className="h-4 w-[88%]" />
        <ChatSkeleton className="h-4 w-[72%]" />
        <ChatSkeleton className="h-4 w-[40%]" />
        <div className="rounded-md border bg-card/40 p-3">
          <div className="flex items-center gap-2">
            <ChatSkeleton className="h-3.5 w-3.5 rounded-sm" />
            <ChatSkeleton className="h-3 w-32" />
          </div>
          <div className="mt-2 space-y-1.5">
            <ChatSkeleton className="h-3 w-[60%]" />
            <ChatSkeleton className="h-3 w-[44%]" />
          </div>
        </div>
        <ChatSkeleton className="h-4 w-[80%]" />
        <ChatSkeleton className="h-4 w-[35%]" />
      </div>
      <div className="flex justify-end">
        <ChatSkeleton className="h-9 w-[40%]" />
      </div>
    </div>
  );
}

function ChatEmptyState({
  agentName,
  onPrompt,
  onNewSession,
}: {
  agentName?: string;
  onPrompt: (p: string) => void;
  onNewSession: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-xl space-y-8 animate-fade-in">

        <div className="text-center">
          <div className="mx-auto mb-3 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/[0.04] px-2.5 py-1">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-accent/60" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            <span className="font-mono text-[10px] tracking-wider text-accent">
              READY
            </span>
          </div>
          <h2 className="text-lg font-semibold">
            开始与{" "}
            <span className="text-gradient-amber font-mono">
              {agentName ?? "Agent"}
            </span>{" "}
            对话
          </h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            选一个推荐 prompt，或直接输入你的问题
          </p>
        </div>

        <div className="grid gap-2">
          {EXAMPLE_PROMPTS.map((p, i) => (
            <button
              key={i}
              onClick={() => onPrompt(p.prompt)}
              className="group flex items-center gap-3 rounded-md border bg-card/40 px-3 py-2.5 text-left transition-all hover:border-accent/40 hover:bg-accent/[0.04]"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground group-hover:bg-accent/10 group-hover:text-accent">
                <p.icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium">{p.title}</div>
                <div className="text-[10.5px] text-muted-foreground/80">
                  {p.desc}
                </div>
              </div>
              <div className="font-mono text-[10px] text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100">
                ↵
              </div>
            </button>
          ))}
        </div>

        <div className="text-center">
          <ChatButton
            variant="ghost"
            size="sm"
            onClick={onNewSession}
            className="font-mono text-[11px] text-muted-foreground"
          >
            <Plus className="h-3 w-3" />
            new session
          </ChatButton>
        </div>
      </div>
    </div>
  );
}
