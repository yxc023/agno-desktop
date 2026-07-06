/**
 * SubAgentSidePanel — 右侧抽屉，展示 team member / sub-agent 的完整内容
 *
 * 设计要点：
 * - 不影响主流程布局（fixed overlay，右半屏）
 * - 支持 breadcrumb：嵌套 sub-of-sub 在内部点击 → push stack
 * - Esc + 点击遮罩关闭
 * - 内容复用 MessageContent（与主流程一致）
 */

import { useEffect, useMemo, useRef } from "react";
import {
  X,
  Bot,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Copy,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useChatStore, useSubMessageById } from "@/stores/chat-store";
import type { ChatMessage } from "@/lib/message-types";
import { useSessionsStore } from "@/stores/sessions-store";
import { useUIStore } from "@/stores/ui-store";
import { MessageContent } from "./MessageContent";

export function SubAgentSidePanel() {
  const stack = useUIStore((s) => s.subAgentPanel.stack);
  const close = useUIStore((s) => s.closeSubAgentPanel);
  const pop = useUIStore((s) => s.popSubAgentPanel);
  const currentSessionId = useSessionsStore((s) => s.currentSessionId);
  // 顶层用 store 维护的 id 索引 O(1) 查 sub-message，Header 和 Body
  // 共享同一个 message 引用，避免双订阅 + 双 walk。
  const top = stack.length > 0 ? stack[stack.length - 1] : null;
  const message = useSubMessageById(
    top?.sessionId ?? null,
    top?.subMessageId ?? null
  );

  // a11y 最小集合：面板打开时把焦点放到关闭按钮上。这样键盘用户按 Enter
  // 就能立即关掉，Tab 键的第一站也是合理的。
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (stack.length === 0) return;
    // requestAnimationFrame 跳过 mount 时的 focus 顺序问题
    const id = requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [stack.length]);

  // Esc 在嵌套栈里先 pop 一层；栈底才整体关闭。
  useEffect(() => {
    if (stack.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (stack.length > 1) pop();
      else close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack.length, close, pop]);

  // Session switch → 关闭面板。栈顶 (subMessageId) 引用的是旧 session 的 sub-message，
  // 留着不动会让 findInTree 返回 null、面板一直显示 "loading…"，且没有 close 路径。
  useEffect(() => {
    if (stack.length === 0) return;
    if (stack[stack.length - 1].sessionId !== currentSessionId) {
      close();
    }
  }, [currentSessionId, stack, close]);

  if (!top) return null;

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
          message={message}
          onClose={close}
          onPop={pop}
          canPop={stack.length > 1}
          closeButtonRef={closeButtonRef}
        />

        <div className="flex-1 overflow-y-auto">
          <SubAgentBody top={top} message={message} />
        </div>
      </aside>
    </>
  );
}

function SubAgentHeader({
  top,
  message,
  onClose,
  onPop,
  canPop,
  closeButtonRef,
}: {
  top: { sessionId: string; subMessageId: string };
  message: ChatMessage | null | undefined;
  onClose: () => void;
  onPop: () => void;
  canPop: boolean;
  closeButtonRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const stack = useUIStore((s) => s.subAgentPanel.stack);

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
        ref={closeButtonRef}
      >
        <X className="h-4 w-4" />
      </Button>
    </header>
  );
}

function SubAgentBody({
  top,
  message,
}: {
  top: { sessionId: string; subMessageId: string };
  message: ChatMessage | null | undefined;
}) {
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
            .map((p) => p.text)
            .join("").length
        : 0,
    [message]
  );

  const textAll = useMemo(() => {
    if (!message) return "";
    return message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
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

      {/* 主内容：复用 MessageContent，loadingHint="sub-agent" 让空 streaming
          显示副文案（"正在等待 sub-agent 输出…"），而不是主流程的三点跳动。
          marker 用 pushPanel 让用户在同一面板栈深入。 */}
      <div className="px-4 py-4">
        <MessageContent
          message={message}
          onOpenSubAgent={(id) => pushPanel(top.sessionId, id)}
          loadingHint="sub-agent"
        />
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
      onClick={() => {
        // writeText 在 非 secure-context 或 权限拒绝 时会 reject —
        // 否则会留下 unhandled promise rejection。
        navigator.clipboard
          ?.writeText(text)
          ?.catch((err) => console.warn("clipboard write failed", err));
      }}
      title="复制全部文本"
    >
      <Copy className="h-3 w-3" />
    </Button>
  );
}
