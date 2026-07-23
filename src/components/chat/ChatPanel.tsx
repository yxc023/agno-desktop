import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  Loader2,
  Plus,
  Bot,
  Sparkles,
  Terminal,
  Cpu,
  Globe,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { VirtualMessageList } from "./VirtualMessageList";
import { MessageInput } from "./MessageInput";
import { ContextProgressBar } from "./ContextProgressBar";
import { useChatStore, useCurrentSessionMessages, useLatestInputTokens, useLatestModelId } from "@/stores/chat-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  useActiveInstance,
  useActiveAgents,
  useIsLoadingAgents,
  useInstancesStore,
} from "@/stores/instances-store";
import type { AgAgentResponse } from "@/lib/agno-types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { UserIdSetupDialog } from "@/components/common/UserIdSetupDialog";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { useHashScroll, writeMessageHash } from "@/hooks/use-hash-scroll";

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

export function ChatPanel() {
  const active = useActiveInstance();
  const agents = useActiveAgents();
  const loadingAgents = useIsLoadingAgents();
  const probe = useInstancesStore((s) => s.probeInstance);
  const loadAgents = useInstancesStore((s) => s.loadAgents);
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
  const runner = useChatStore((s) => s.runner);
  const autoScroll = useSettingsStore((s) => s.autoScroll);
  const userId = useSettingsStore((s) => s.userId);
  const userIdConfirmed = useSettingsStore((s) => s.userIdConfirmed);
  const [showUserIdSetup, setShowUserIdSetup] = useState(false);

  const {
    scrollRef,
    stickToBottom,
    jumpToBottom,
    pause: pauseAutoScroll,
    onScroll,
    onWheel,
  } = useAutoScroll({ enabled: autoScroll });

  const hashTargetId = useHashScroll();

  /**
   * Hash 深链 (URL 自带 #message-X，或 popstate / 用户在地址栏改 hash) active
   * 时 pause autoScroll——避免 useAutoScroll 内的 ResizeObserver 在虚拟化器
   * 内容变化时把视口拉回底部，覆盖 VirtualMessageList 的 scrollToIndex 跳转。
   *
   * "自写" hash（auto-tracking 滚动位置时调 writeMessageHash({ silent: true })）
   * 不会更新 useHashScroll 的 target state，hashTargetId 保持不变 → 本 effect
   * 不会重复触发 → autoscroll 正常工作。这是修"reload 后 autoscroll 失活"
   * 这个 bug 的核心：之前两者都会设 hash → 一旦 auto-tracking 写入 hash，
   * pause 就被永久锁住。
   *
   * Resume：用户点 "back to bottom" 按钮（jumpToBottom）或自然滚回底部
   * （handleScroll: user-paused → sticky）都会重新激活 autoscroll。
   */
  useEffect(() => {
    if (hashTargetId) pauseAutoScroll();
  }, [hashTargetId, pauseAutoScroll]);

  // 进入 chat 页面时立即拉取 agents + sessions
  useEffect(() => {
    if (!active) return;
    const hasAgents = active.agents && active.agents.length > 0;
    const isStale =
      !active.agentsFetchedAt ||
      Date.now() - active.agentsFetchedAt > 60_000;
    if (!hasAgents || isStale) {
      loadAgents(active.id, !hasAgents);
    }
  }, [active?.id, loadAgents]);

  useEffect(() => {
    // 只要 session 还没拉过历史，就触发一次 loadHistory。
    // 用 `loadedHistoryBySession` 而非 `messages.length === 0` 作为触发条件，
    // 避免"消息为空就重新拉"的回环——同时保留对 race / LRU 过期场景的容错。
    if (currentSessionId && active && !loadedHistory && !loadingHistory) {
      loadHistory(currentSessionId);
    }
  }, [currentSessionId, active, loadedHistory, loadingHistory, loadHistory]);

  /**
   * 兜底：切换 session / 历史加载完毕时若没触发 RO（scrollHeight 未变）也滚到底。
   * 依赖里不放 `messages` —— streaming 期间的滚动完全交给 useAutoScroll 内的 RO。
   * 但如果有 hash 目标（深链 / scroll restoration），优先滚到 hash 而不是底。
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (hashTargetId) return; // VirtualMessageList 的 scrollToMessageId effect 会处理
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight });
    });
  }, [currentSessionId, loadedHistory, hashTargetId]);

  /**
   * 用户滚动 → topmost 可见 message 变化 → 写回 URL hash（debounced 150ms 由
   * VirtualMessageList 内部完成）。这里只接 onActiveMessageChange → writeMessageHash。
   */
  const handleActiveMessageChange = useCallback((id: string | null) => {
    if (!id) return;
    // silent: true → useHashScroll 看到这次 hashchange 时不更新 target state，
    // 避免 ChatPanel 的 pauseAutoScroll effect 因"自写 hash"被反复触发，
    // 永久 disable autoscroll（之前 reload 后 autoscroll 失活的根因）。
    writeMessageHash(id, { silent: true });
  }, []);

  if (!active) {
    return null;
  }

  const isRunning = runner?.isRunning() ?? false;
  const agentsError = active.lastAgentsError;
  const needUserId = !userId.trim() || !userIdConfirmed;
  // 当前选中的 agent（用来读 model id → 查 context window）
  const selectedAgent =
    agents.find((a) => a.id === selectedAgentId) ?? agents[0] ?? null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/60 px-4 backdrop-blur-sm">
        <Select
          value={selectedAgentId ?? ""}
          onValueChange={(v) => setSelectedAgent(v)}
        >
          <SelectTrigger className="h-7 w-auto min-w-[200px] border-none bg-transparent shadow-none hover:bg-muted font-mono text-[12px]">
            {loadingAgents ? (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                loading agents…
              </span>
            ) : (
              <SelectValue placeholder="选择 Agent" />
            )}
          </SelectTrigger>
          <SelectContent>
            {loadingAgents && (
              <div className="flex items-center gap-2 px-2 py-3 font-mono text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                正在从实例拉取 agents...
              </div>
            )}

            {!loadingAgents && agentsError && (
              <div className="space-y-2 px-2 py-2">
                <div className="flex items-start gap-1.5 font-mono text-[11px] text-destructive">
                  <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                  <div className="flex-1 break-all whitespace-pre-line">
                    <div className="font-medium">拉取失败</div>
                    <div className="text-destructive/80 text-[10px] mt-0.5">
                      {agentsError}
                    </div>
                  </div>
                </div>
                {agentsError.includes("CORS") &&
                  active &&
                  /^https?:\/\//i.test(active.baseUrl) && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-full border-accent/40 text-accent"
                      onClick={(e) => {
                        e.preventDefault();
                        if (!active) return;
                        const id = active.id;
                        useInstancesStore
                          .getState()
                          .updateInstance(id, { baseUrl: "/api" });
                        // 重新探活 + 拉取（用最新的 store state）
                        setTimeout(() => {
                          const fresh = useInstancesStore
                            .getState()
                            .instances.find((i) => i.id === id);
                          if (!fresh) return;
                          useInstancesStore.getState().probeInstance(id);
                          useInstancesStore
                            .getState()
                            .loadAgents(id, true);
                        }, 100);
                      }}
                    >
                      <Terminal className="h-3 w-3 mr-1.5" />
                      一键改用 /api 代理
                    </Button>
                  )}
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 flex-1 text-[11px]"
                    onClick={(e) => {
                      e.preventDefault();
                      if (active) {
                        probe(active.id);
                        loadAgents(active.id, true);
                      }
                    }}
                  >
                    <RefreshCw className="h-3 w-3 mr-1.5" />
                    重试
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    onClick={(e) => {
                      e.preventDefault();
                      const docsBase =
                        active.baseUrl.replace(/\/api\/?$/, "") ||
                        active.baseUrl;
                      window.open(`${docsBase}/docs`, "_blank");
                    }}
                    title="查看 AGNO API 文档"
                  >
                    <Terminal className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}

            {!loadingAgents && !agentsError && agents.length === 0 && (
              <div className="space-y-2 px-2 py-3">
                <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                  <AlertCircle className="h-3 w-3 text-warning" />
                  当前实例未发现 agent
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-full text-[11px]"
                  onClick={(e) => {
                    e.preventDefault();
                    if (active) loadAgents(active.id, true);
                  }}
                >
                  <RefreshCw className="h-3 w-3 mr-1.5" />
                  重新拉取
                </Button>
              </div>
            )}

            {!loadingAgents &&
              !agentsError &&
              agents.map((a: AgAgentResponse) => (
                <SelectItem
                  key={a.id}
                  value={a.id}
                  className="font-mono text-[12px]"
                >
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                    <span className="font-medium">{a.name ?? a.id}</span>
                    {a.model &&
                      (typeof a.model === "object"
                        ? a.model.name
                        : a.model) && (
                        <span className="text-[10px] text-muted-foreground">
                          {typeof a.model === "object"
                            ? a.model.name
                            : a.model}
                        </span>
                      )}
                  </div>
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        {active && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-6 w-6"
            onClick={() => {
              probe(active.id);
              loadAgents(active.id, true);
            }}
            title="重新探活 + 拉取 agents"
            disabled={loadingAgents}
          >
            <RefreshCw
              className={cn("h-3 w-3", loadingAgents && "animate-spin")}
            />
          </Button>
        )}

        <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground/70">
          <span className="h-1 w-1 rounded-full bg-success" />
          <span className="truncate max-w-[240px]">{active.baseUrl}</span>
        </div>

        {/* user_id 显示 + 快速编辑 */}
        {userId.trim() && (
          <button
            onClick={() => setShowUserIdSetup(true)}
            className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground/70 hover:bg-muted/50 hover:text-foreground"
            title="点击修改 user_id"
          >
            <User className="h-2.5 w-2.5" />
            <span>{userId}</span>
          </button>
        )}

        {/* Context 进度（圆环）：18px SVG 圆环，hover 弹 tooltip 显示数字 */}
        <ContextProgressBar
          currentTokens={currentInputTokens}
          agent={selectedAgent}
          modelId={currentModelId}
        />

        <div className="flex items-center gap-1.5">
          {needUserId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowUserIdSetup(true)}
              className="h-7 border-warning/50 text-warning"
            >
              <AlertTriangle className="h-3 w-3 mr-1" />
              <span className="text-[11px]">设置 user_id</span>
            </Button>
          )}
          {isRunning && (
            <div className="flex items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
              <span className="font-mono text-[10px] text-accent">streaming</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => newSession(selectedAgentId ?? undefined)}
            className="h-7 font-mono text-[11px]"
          >
            <Plus className="h-3 w-3" />
            <span>new</span>
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          onWheel={onWheel}
          className="absolute inset-0 overflow-y-auto"
        >
          {currentSessionId && messages.length > 0 ? (
            <div className="mx-auto max-w-4xl py-6">
              <VirtualMessageList
                messages={messages}
                scrollRef={scrollRef}
                loadingHistory={loadingHistory}
                cacheKey={currentSessionId}
                scrollToMessageId={hashTargetId ?? undefined}
                onActiveMessageChange={handleActiveMessageChange}
              />
            </div>
          ) : currentSessionId && (loadingHistory || !loadedHistory) ? (
            // 历史还没回来（或正在拉取）时显示 skeleton，
            // 避免切到未打开过的 session 时跳一下 ChatEmptyState
            <ChatHistorySkeleton />
          ) : (
            <ChatEmptyState
              agentName={
                agents.find((a) => a.id === selectedAgentId)?.name ??
                selectedAgentId ??
                agents[0]?.name
              }
              onPrompt={(p) => {
                if (needUserId) {
                  setShowUserIdSetup(true);
                  return;
                }
                if (!selectedAgentId && agents[0]) {
                  setSelectedAgent(agents[0].id);
                }
                sendMessage({ text: p });
              }}
              onNewSession={() => {
                if (needUserId) {
                  setShowUserIdSetup(true);
                  return;
                }
                newSession(selectedAgentId ?? undefined);
              }}
              needUserId={needUserId}
              onSetupUserId={() => setShowUserIdSetup(true)}
            />
          )}
        </div>

        {!stickToBottom && messages.length > 0 && (
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => jumpToBottom(true)}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-lg bg-card/95 backdrop-blur-sm border-border"
          >
            <ArrowDown className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Input always at bottom */}
      {currentSessionId && <MessageInput />}

      <UserIdSetupDialog
        open={showUserIdSetup}
        onOpenChange={setShowUserIdSetup}
      />
    </div>
  );
}

/**
 * History loading skeleton — 切到一个还没拉过历史的 session 时显示，
 * 避免一闪 ChatEmptyState（用户描述的"先看到欢迎界面再切换到消息列表"问题）。
 *
 * 设计选择：仅显示中性 skeleton，不显示标题 / example prompt —— 因为
 * 这些信息属于 ChatEmptyState（"还没对话内容"）的语义；这里只是"正在加载"，
 * 用户应该看到的反馈是"在拉历史"，而不是被错误暗示"这是个空 session"。
 */
function ChatHistorySkeleton() {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground/70">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>loading history…</span>
      </div>
      {/* User bubble skeleton */}
      <div className="flex justify-end">
        <Skeleton className="h-9 w-[55%]" />
      </div>
      {/* Assistant turn skeleton */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-[88%]" />
        <Skeleton className="h-4 w-[72%]" />
        <Skeleton className="h-4 w-[40%]" />
        {/* Tool-call card skeleton */}
        <div className="rounded-md border bg-card/40 p-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3.5 w-3.5 rounded-sm" />
            <Skeleton className="h-3 w-32" />
          </div>
          <div className="mt-2 space-y-1.5">
            <Skeleton className="h-3 w-[60%]" />
            <Skeleton className="h-3 w-[44%]" />
          </div>
        </div>
        <Skeleton className="h-4 w-[80%]" />
        <Skeleton className="h-4 w-[35%]" />
      </div>
      {/* Another user bubble skeleton */}
      <div className="flex justify-end">
        <Skeleton className="h-9 w-[40%]" />
      </div>
    </div>
  );
}

function ChatEmptyState({
  agentName,
  onPrompt,
  onNewSession,
  needUserId,
  onSetupUserId,
}: {
  agentName?: string;
  onPrompt: (p: string) => void;
  onNewSession: () => void;
  needUserId?: boolean;
  onSetupUserId?: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-xl space-y-8 animate-fade-in">
        {needUserId && (
          <div className="rounded-md border border-warning/40 bg-warning/[0.04] p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <div className="text-[13px] font-medium text-warning">
                  还没有设置 user_id
                </div>
                <p className="text-[11.5px] text-muted-foreground">
                  user_id 用于 AGNO 归类你的 session、memory 和 user-level 数据。
                  设置后所有实例共用。
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onSetupUserId}
                  className="mt-1 h-7 border-warning/50 text-warning"
                >
                  <User className="h-3 w-3 mr-1.5" />
                  立即设置
                </Button>
              </div>
            </div>
          </div>
        )}

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
          <Button
            variant="ghost"
            size="sm"
            onClick={onNewSession}
            className="font-mono text-[11px] text-muted-foreground"
          >
            <Plus className="h-3 w-3" />
            new session
          </Button>
        </div>
      </div>
    </div>
  );
}