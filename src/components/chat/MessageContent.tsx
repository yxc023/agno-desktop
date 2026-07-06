/**
 * MessageContent — 把 ChatMessage.parts 渲染成可视内容
 *
 * 复用于：
 * - 主流程的 MessageBubble
 * - 右侧 SubAgentSidePanel（sub-agent 详情）
 *
 * 内嵌的 SubMessageMarker part 渲染成"chip"——点击进入 sub-agent 视图。
 * 跳转行为由 callback 注入：
 *   - 主流程用 onOpenSubAgent (replace stack)
 *   - 侧栏用 onPushSubAgent (push stack)
 */

import {
  AlertCircle,
  Bot,
  Loader2,
  ArrowRight,
  Activity,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/markdown/Markdown";
import { ReasoningBlock } from "./ReasoningBlock";
import { ToolCallCard } from "./ToolCallCard";
import { useChatStore, useSubMessageById } from "@/stores/chat-store";
import type { ChatMessage, MessagePart } from "@/lib/message-types";

interface MessageContentProps {
  message: ChatMessage;
  /** 跳转 sub-agent 的回调；不传则 marker 不渲染按钮（兜底提示）。 */
  onOpenSubAgent?: (subMessageId: string) => void;
  /**
   * 空 streaming 时显示的兜底 affordance：
   *   - "main"（默认）   → 三点跳动（主流程轻量）
   *   - "sub-agent"      → "正在等待 sub-agent 输出…" 副文案 + 呼吸图标
   *                       （侧栏需要更显眼的提示）
   */
  loadingHint?: "main" | "sub-agent";
}

export function MessageContent({
  message,
  onOpenSubAgent,
  loadingHint = "main",
}: MessageContentProps) {
  if (message.parts.length === 0 && message.status === "streaming") {
    if (loadingHint === "sub-agent") {
      return (
        <div className="flex items-center gap-1.5 py-4 font-mono text-[11px] text-muted-foreground/70">
          <Activity className="h-3 w-3 animate-pulse text-accent" />
          <span>正在等待 sub-agent 输出…</span>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground py-1">
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-dot" />
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-dot [animation-delay:0.15s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-dot [animation-delay:0.3s]" />
      </div>
    );
  }

  if (message.parts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5">
      {message.parts.map((part, idx) => (
        <PartRenderer
          key={idx}
          part={part}
          message={message}
          index={idx}
          onOpenSubAgent={onOpenSubAgent}
        />
      ))}
    </div>
  );
}

function PartRenderer({
  part,
  message,
  index,
  onOpenSubAgent,
}: {
  part: MessagePart;
  message: ChatMessage;
  index: number;
  onOpenSubAgent?: (subMessageId: string) => void;
}) {
  const isLast = index === message.parts.length - 1;
  const streaming =
    message.status === "streaming" && isLast && part.type === "text";

  switch (part.type) {
    case "text":
      return (
        <div className="text-[14px] leading-[1.7] text-foreground/95">
          <Markdown streaming={streaming}>{part.text}</Markdown>
        </div>
      );

    case "reasoning":
      return (
        <ReasoningBlock
          text={part.text}
          steps={part.steps}
          streaming={message.status === "streaming" && isLast}
        />
      );

    case "tool_call":
      return <ToolCallCard tool={part} />;

    case "sub_message_marker":
      return (
        <SubMessageMarkerChip
          part={part}
          message={message}
          onOpenSubAgent={onOpenSubAgent}
        />
      );

    case "reference":
      return (
        <div className="my-2 overflow-hidden rounded-md border border-info/30 bg-info/[0.04]">
          <div className="border-b border-info/20 bg-info/[0.06] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-info">
            引用来源 · {part.references.length}
          </div>
          <div className="space-y-1 p-2">
            {part.references.map((ref, i) => (
              <a
                key={i}
                href={ref.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded px-2 py-1.5 transition-colors hover:bg-info/[0.06]"
              >
                <div className="font-mono text-[10px] text-info/80">
                  [{String(i + 1).padStart(2, "0")}]
                </div>
                <div className="text-[12.5px] font-medium text-info">
                  {ref.title || ref.url}
                </div>
                {ref.excerpt && (
                  <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                    {ref.excerpt}
                  </div>
                )}
              </a>
            ))}
          </div>
        </div>
      );

    case "image":
      return (
        <img
          src={part.url}
          alt={part.alt}
          className="my-2 max-w-full rounded-md border"
          loading="lazy"
        />
      );

    case "audio":
      return (
        <audio controls src={part.url} className="my-2 w-full">
          <track kind="captions" />
        </audio>
      );

    case "video":
      return (
        <video
          controls
          src={part.url}
          className="my-2 max-w-full rounded-md"
        />
      );

    case "error":
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-medium">错误</div>
            <div className="mt-0.5 font-mono text-destructive/80">
              {part.message}
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}

/**
 * Sub-agent 入口 chip
 * 复用：根据 onOpenSubAgent 是否传入，渲染成"打开侧栏"按钮；传入则用之。
 * 也负责从 chat-store 反查 sub-message（任意深度），拿到 displayName / status 摘要。
 */

function SubMessageMarkerChip({
  part,
  message,
  onOpenSubAgent,
}: {
  part: Extract<MessagePart, { type: "sub_message_marker" }>;
  message: ChatMessage;
  onOpenSubAgent?: (subMessageId: string) => void;
}) {
  const sessionId = message.sessionId;
  // 用 store 维护的 id 索引 O(1) 查 sub，替代 findInTree 的 O(N) walk。
  const sub = useSubMessageById(message.sessionId ?? null, part.subMessageId);

  // loading → "unavailable" 超时。3s 后 sub 仍找不到，视为 orphan marker
  // (例如 history 丢了 sub-message / 跳号 / event 缺失)，UI 不再让用户以为
  // 它还在跑。`sub` 找到时立即重置回 loading 状态。
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (sub || !onOpenSubAgent) return;
    setUnavailable(false);
    const t = setTimeout(() => setUnavailable(true), 3000);
    return () => clearTimeout(t);
  }, [sub, onOpenSubAgent]);

  if (!onOpenSubAgent) {
    // 兜底：没有回调时只显示摘要，不能交互
    return (
      <div className="my-1 inline-flex items-center gap-1 rounded-md border border-dashed border-border/60 bg-muted/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/60">
        <Bot className="h-2.5 w-2.5" />
        <span>sub-agent (no opener)</span>
      </div>
    );
  }

  if (!sub) {
    return (
      <div className="my-1 inline-flex items-center gap-1 rounded-md border border-dashed border-border/60 bg-muted/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/60">
        <Bot className="h-2.5 w-2.5" />
        <span>
          {unavailable
            ? "sub-agent (unavailable)"
            : "sub-agent (loading…)"}
        </span>
      </div>
    );
  }

  const name = sub.displayName ?? sub.agentId ?? "sub-agent";
  const isStreaming = sub.status === "streaming";
  const toolCount = sub.parts.filter((p) => p.type === "tool_call").length;
  const hasReasoning = sub.parts.some((p) => p.type === "reasoning");

  return (
    <button
      type="button"
      onClick={() => sessionId && onOpenSubAgent(sub.id)}
      className={cn(
        "group my-1 inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-left transition-all",
        isStreaming
          ? "border-accent/50 bg-accent/[0.06] hover:border-accent/70"
          : "border-border bg-muted/40 hover:border-accent/50 hover:bg-accent/[0.04]"
      )}
    >
      <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-accent/15 ring-1 ring-accent/30">
        {isStreaming ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin text-accent" />
        ) : (
          <Bot className="h-2.5 w-2.5 text-accent" />
        )}
      </div>
      <span className="font-mono text-[11px] font-medium text-foreground/90">
        {name}
      </span>
      <span className="font-mono text-[10px] text-muted-foreground/60">
        · sub-agent
      </span>
      {toolCount > 0 && (
        <span className="font-mono text-[10px] text-muted-foreground/60">
          · {toolCount} tool{toolCount === 1 ? "" : "s"}
        </span>
      )}
      {hasReasoning && (
        <span className="font-mono text-[10px] text-muted-foreground/60">
          · 推理
        </span>
      )}
      <ArrowRight className="ml-1 h-3 w-3 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
    </button>
  );
}
