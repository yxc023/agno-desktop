/**
 * SubAgentSidePanel — 右侧抽屉，展示 team member / sub-agent 的完整内容
 *
 * 设计要点：
 * - 不影响主流程布局（fixed overlay，右半屏）
 * - 支持 breadcrumb：嵌套 sub-of-sub 在内部点击 → push stack
 * - Esc + 点击遮罩关闭
 * - 内容复用 MessageContent（与主流程一致）
 */

import { useEffect, useMemo } from "react";
import {
  X,
  Bot,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Activity,
  Copy,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useChatStore } from "@/stores/chat-store";
import { useUIStore, findInTree } from "@/stores/ui-store";
import { MessageContent } from "./MessageContent";

export function SubAgentSidePanel() {
  const stack = useUIStore((s) => s.subAgentPanel.stack);
  const close = useUIStore((s) => s.closeSubAgentPanel);
  const pop = useUIStore((s) => s.popSubAgentPanel);

  // Esc 关闭
  useEffect(() => {
    if (stack.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack.length, close]);

  if (stack.length === 0) return null;
  const top = stack[stack.length - 1];

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-background/30 backdrop-blur-[1px] animate-fade-in"
        onClick={close}
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-[min(560px,80vw)] flex-col border-l border-border bg-background shadow-2xl animate-slide-in-right"
        role="dialog"
        aria-modal="true"
        aria-label="Sub-agent 详情"
      >
        <SubAgentHeader
          top={top}
          onClose={close}
          onPop={pop}
          canPop={stack.length > 1}
        />

        <div className="flex-1 overflow-y-auto">
          <SubAgentBody top={top} />
        </div>
      </aside>
    </>
  );
}

function SubAgentHeader({
  top,
  onClose,
  onPop,
  canPop,
}: {
  top: { sessionId: string; subMessageId: string };
  onClose: () => void;
  onPop: () => void;
  canPop: boolean;
}) {
  const stack = useUIStore((s) => s.subAgentPanel.stack);
  const message = useChatStore((s) => {
    const list = s.messagesBySession[top.sessionId] ?? [];
    return findInTree(list, top.subMessageId);
  });

  const name = message?.displayName ?? message?.agentId ?? "sub-agent";
  const isStreaming = message?.status === "streaming";
  const isCompleted = message?.status === "completed";
  const isError = message?.status === "error";
  const isCancelled = message?.status === "cancelled";

  const statusLabel = !message
    ? "loading…"
    : isStreaming
    ? "running"
    : isCompleted
    ? "done"
    : isError
    ? "failed"
    : isCancelled
    ? "cancelled"
    : message.status;

  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
      {canPop ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onPop}
          className="h-7 w-7"
          title="返回上一层"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      ) : (
        <div className="flex h-7 w-7 items-center justify-center rounded bg-accent/15 ring-1 ring-accent/30">
          <Bot className="h-4 w-4 text-accent" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate font-mono text-[13px] font-semibold text-foreground/95">
            {name}
          </h2>
          <span className="font-mono text-[10px] text-muted-foreground/60">
            · sub-agent
          </span>
          {isStreaming && (
            <span className="flex items-center gap-1 font-mono text-[10px] text-accent">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              running
            </span>
          )}
          {!isStreaming && message && (
            <Badge
              variant={
                isCompleted
                  ? "default"
                  : isError
                  ? "destructive"
                  : isCancelled
                  ? "warning"
                  : "secondary"
              }
              className="font-mono text-[10px]"
            >
              {statusLabel}
            </Badge>
          )}
        </div>
        {stack.length > 1 && (
          <div className="mt-1 flex items-center gap-1 font-mono text-[10px] text-muted-foreground/60">
            {stack.map((_, i) => (
              <span
                key={i}
                className="flex items-center gap-1"
              >
                {i > 0 && <ChevronRight className="h-2.5 w-2.5" />}
                <span>level {i + 1}</span>
              </span>
            ))}
          </div>
        )}
        {message && (
          <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/60">
            run:{" "}
            <span className="text-muted-foreground/80">
              {message.runId ?? "—"}
            </span>
            {message.createdAt > 0 && (
              <> · {formatRelativeTime(message.createdAt)}</>
            )}
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        className="h-7 w-7"
        title="关闭（Esc）"
      >
        <X className="h-4 w-4" />
      </Button>
    </header>
  );
}

function SubAgentBody({
  top,
}: {
  top: { sessionId: string; subMessageId: string };
}) {
  const message = useChatStore((s) => {
    const list = s.messagesBySession[top.sessionId] ?? [];
    return findInTree(list, top.subMessageId);
  });
  const pushPanel = useUIStore((s) => s.pushSubAgentPanel);

  const toolCount = useMemo(
    () => (message ? message.parts.filter((p) => p.type === "tool_call").length : 0),
    [message]
  );
  const textLength = useMemo(
    () =>
      message
        ? message.parts
            .filter((p) => p.type === "text")
            .map((p) => (p as any).text)
            .join("").length
        : 0,
    [message]
  );

  const textAll = useMemo(() => {
    if (!message) return "";
    return message.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as any).text)
      .join("\n");
  }, [message]);

  if (!message) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-muted-foreground">
        <div className="space-y-2 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          <div className="font-mono text-[11px]">
            正在从 store 读取 sub-agent 数据…
          </div>
        </div>
      </div>
    );
  }

  const isEmptyStreaming =
    message.parts.length === 0 && message.status === "streaming";

  return (
    <div className="flex flex-col">
      {/* summary bar */}
      <div className="flex items-center gap-3 border-b border-border/40 bg-muted/20 px-4 py-2 font-mono text-[10.5px] text-muted-foreground/80">
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground/60">tools</span>
          <span className="text-foreground/90">{toolCount}</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="text-muted-foreground/60">text</span>
          <span className="text-foreground/90">{textLength} chars</span>
        </span>
        {message.metrics?.total_tokens != null && (
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground/60">tokens</span>
            <span className="text-foreground/90">
              {message.metrics.total_tokens.toLocaleString()}
            </span>
          </span>
        )}
        {message.metrics?.duration != null && (
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground/60">dur</span>
            <span className="text-foreground/90">
              {(message.metrics.duration / 1000).toFixed(1)}s
            </span>
          </span>
        )}
        <span className="ml-auto">
          <CopyTextButton text={textAll} />
        </span>
      </div>

      {/* 主内容：复用 MessageContent，marker 用 pushPanel 让用户在同一面板栈深入 */}
      <div className="px-4 py-4">
        {isEmptyStreaming ? (
          <EmptyStreaming />
        ) : (
          <MessageContent
            message={message}
            onOpenSubAgent={(id) => pushPanel(top.sessionId, id)}
          />
        )}
      </div>

      {/* 嵌套 sub-of-sub 列表（即使无 marker 也兜底显示） */}
      {message.subMessages && message.subMessages.length > 0 && (
        <div className="border-t border-border/40 px-4 py-3">
          <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
            nested sub-agents
          </h3>
          <div className="space-y-1">
            {message.subMessages.map((s) => (
              <button
                key={s.id}
                onClick={() => pushPanel(top.sessionId, s.id)}
                className="group flex w-full items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-left transition-colors hover:border-accent/50 hover:bg-accent/[0.04]"
              >
                <Bot className="h-3.5 w-3.5 text-accent" />
                <span className="font-mono text-[11.5px] font-medium text-foreground/90">
                  {s.displayName ?? s.agentId ?? "sub-agent"}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground/60">
                  ·{" "}
                  {s.parts.filter((p) => p.type === "tool_call").length} tools
                </span>
                <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CopyTextButton({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="h-6 w-6"
      onClick={() => navigator.clipboard?.writeText(text)}
      title="复制全部文本"
    >
      <Copy className="h-3 w-3" />
    </Button>
  );
}

function EmptyStreaming() {
  return (
    <div className="flex items-center gap-1.5 py-4 font-mono text-[11px] text-muted-foreground/70">
      <Activity className="h-3 w-3 animate-pulse text-accent" />
      <span>正在等待 sub-agent 输出…</span>
    </div>
  );
}
