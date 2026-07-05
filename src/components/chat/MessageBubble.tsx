import {
  AlertCircle,
  User,
  Copy,
  Check,
} from "lucide-react";
import { useState } from "react";
import { cn, copyToClipboard, formatRelativeTime } from "@/lib/utils";
import { Markdown } from "@/components/markdown/Markdown";
import { ReasoningBlock } from "./ReasoningBlock";
import { ToolCallCard } from "./ToolCallCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ChatMessage, MessagePart } from "@/lib/message-types";

interface Props {
  message: ChatMessage;
  onCopy?: () => void;
}

export function MessageBubble({ message, onCopy }: Props) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return <SystemMessage message={message} />;
  }

  if (isUser) {
    return <UserMessage message={message} onCopy={onCopy} />;
  }

  // assistant：完全平铺，无 avatar/名字
  return (
    <AssistantMessage message={message} onCopy={onCopy} />
  );
}

function UserMessage({ message, onCopy }: Props) {
  const [copied, setCopied] = useState(false);
  const text = message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .filter(Boolean)
    .join("\n");

  async function handleCopy() {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
    onCopy?.();
  }

  return (
    <div className="animate-fade-in px-4 pt-6 pb-2">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-muted/80 ring-1 ring-border">
            <User className="h-2.5 w-2.5 text-muted-foreground" />
          </div>
          <span className="text-[11px] font-medium text-muted-foreground">
            You
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/60">
            {formatRelativeTime(message.createdAt)}
          </span>
          <div className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleCopy}
              className="h-5 w-5"
            >
              {copied ? (
                <Check className="h-3 w-3 text-success" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
        </div>
        <div className="text-[13.5px] leading-[1.7] text-foreground/95">
          <Markdown>{text}</Markdown>
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ message, onCopy }: Props) {
  const [copied, setCopied] = useState(false);
  const hasParts = message.parts.length > 0;
  const hasText = message.parts.some((p) => p.type === "text");
  const isStreaming = message.status === "streaming";

  const text = message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .filter(Boolean)
    .join("\n");

  async function handleCopy() {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
    onCopy?.();
  }

  return (
    <div
      className={cn(
        "group relative animate-fade-in px-4 pt-2 pb-6",
        isStreaming && "border-l-2 border-accent/30"
      )}
    >
      <div className="mx-auto max-w-3xl">
        {/* 没有 avatar / 名字 / agent tag —— 纯平铺 */}

        <MessageContent message={message} />

        {/* footer: 状态 + 指标 + copy */}
        {(isStreaming ||
          message.status === "cancelled" ||
          message.status === "error" ||
          message.status === "paused" ||
          message.metrics?.total_tokens ||
          hasText) && (
          <MessageFooter
            message={message}
            onCopy={handleCopy}
            copied={copied}
          />
        )}
      </div>
    </div>
  );
}

function MessageContent({ message }: { message: ChatMessage }) {
  if (message.parts.length === 0 && message.status === "streaming") {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground py-1">
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-dot" />
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-dot [animation-delay:0.15s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-dot [animation-delay:0.3s]" />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {message.parts.map((part, idx) => (
        <PartRenderer
          key={idx}
          part={part}
          message={message}
          index={idx}
        />
      ))}
    </div>
  );
}

function PartRenderer({
  part,
  message,
  index,
}: {
  part: MessagePart;
  message: ChatMessage;
  index: number;
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

function MessageFooter({
  message,
  onCopy,
  copied,
}: {
  message: ChatMessage;
  onCopy?: () => void;
  copied?: boolean;
}) {
  if (
    message.status !== "cancelled" &&
    message.status !== "error" &&
    message.status !== "paused" &&
    message.status !== "streaming" &&
    !message.metrics?.total_tokens
  ) {
    return null;
  }
  return (
    <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-2 font-mono text-[10px] text-muted-foreground/60">
      {message.status === "cancelled" && (
        <Badge variant="warning" className="font-mono text-[10px]">
          cancelled
        </Badge>
      )}
      {message.status === "error" && (
        <Badge variant="destructive" className="font-mono text-[10px]">
          failed
        </Badge>
      )}
      {message.status === "paused" && (
        <Badge variant="warning" className="font-mono text-[10px]">
          awaiting input
        </Badge>
      )}
      {message.status === "streaming" && (
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse-dot" />
          <span className="text-accent">streaming</span>
        </div>
      )}
      {message.metrics?.total_tokens != null && (
        <span className="ml-auto flex items-center gap-2">
          <span>
            {message.metrics.total_tokens.toLocaleString()} tok
            {message.metrics.duration
              ? ` · ${(message.metrics.duration / 1000).toFixed(1)}s`
              : ""}
          </span>
          {onCopy && (
            <button
              onClick={onCopy}
              className="ml-2 rounded p-0.5 opacity-50 hover:bg-muted hover:opacity-100"
              title="复制"
            >
              {copied ? (
                <Check className="h-3 w-3 text-success" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function SystemMessage({ message }: Props) {
  return (
    <div className="border-y border-dashed border-border bg-muted/30 px-4 py-2 font-mono text-[11px] text-muted-foreground">
      <div className="mx-auto max-w-3xl">
        {message.parts
          .map((p) => (p.type === "text" ? p.text : ""))
          .filter(Boolean)
          .join("\n")}
      </div>
    </div>
  );
}