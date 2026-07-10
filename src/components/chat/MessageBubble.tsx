import {
  User,
  Copy,
  Check,
  Bot,
  PanelRightOpen,
} from "lucide-react";
import { useState } from "react";
import { cn, copyToClipboard, formatRelativeTime } from "@/lib/utils";
import { Markdown } from "@/components/markdown/Markdown";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ChatMessage, MessagePart } from "@/lib/message-types";
import { useUIStore } from "@/stores/ui-store";
import { MessageContent } from "./MessageContent";

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

  return <AssistantMessage message={message} onCopy={onCopy} />;
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
    <div className="group animate-fade-in px-4 pt-6 pb-3">
      <div className="mx-auto max-w-4xl">
        {/* Header row：右对齐（与气泡一致），让 avatar / 名字 / 时间都在右侧。
            copy 按钮放在最左（与气泡的"主操作靠外"语义对齐）。 */}
        <div className="mb-1.5 flex items-center justify-end gap-2">
          <div className="opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleCopy}
              className="h-5 w-5"
              title="复制"
            >
              {copied ? (
                <Check className="h-3 w-3 text-success" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground/60">
            {formatRelativeTime(message.createdAt)}
          </span>
          <span className="text-[11px] font-semibold text-foreground/90">
            You
          </span>
          <div className="flex h-5 w-5 items-center justify-center rounded bg-primary text-primary-foreground ring-1 ring-primary/30">
            <User className="h-2.5 w-2.5" />
          </div>
        </div>

        {/* Bubble：右对齐，淡琥珀色背景 + 边框，凸显用户输入
            - 不用纯色填充，避免视觉过重抢走主流程焦点
            - 圆角采用"右下略小"，呼应"消息流向"的隐喻 */}
        <div className="ml-auto w-fit max-w-[85%] rounded-lg rounded-br-sm border border-primary/15 bg-primary/[0.06] px-3.5 py-2.5 shadow-sm">
          <div className="text-[13.5px] leading-[1.7] text-foreground/95">
            <Markdown>{text}</Markdown>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ message, onCopy }: Props) {
  const [copied, setCopied] = useState(false);
  const hasText = message.parts.some((p) => p.type === "text");
  const isStreaming = message.status === "streaming";
  const subMessages = message.subMessages ?? [];

  const openPanel = useUIStore((s) => s.openSubAgentPanel);

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
      <div className="mx-auto max-w-4xl">
        <MessageContent
          message={message}
          onOpenSubAgent={(id) =>
            message.sessionId
              ? openPanel(message.sessionId, id)
              : undefined
          }
        />

        {/* 历史/未通过 marker 暴露的 sub-agent 的兜底入口 */}
        <SubAgentFooterAssistant
          subs={subMessages}
          parts={message.parts}
          sessionId={message.sessionId}
        />

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

/* ---------------------------------------------------------------- */
/* Sub-agent 兜底 footer（当 marker 缺失时的入口）                  */
/* ---------------------------------------------------------------- */

function SubAgentFooterAssistant({
  subs,
  parts,
  sessionId,
}: {
  subs: ChatMessage[];
  parts: MessagePart[];
  sessionId?: string;
}) {
  const openPanel = useUIStore((s) => s.openSubAgentPanel);

  const exposedIds = new Set(
    parts
      .filter((p) => p.type === "sub_message_marker")
      .map((p) => p.subMessageId)
  );
  const orphans = subs.filter((s) => !exposedIds.has(s.id));
  if (orphans.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60 self-center">
        sub-agent
      </span>
      {orphans.map((s) => (
        <button
          key={s.id}
          onClick={() =>
            sessionId ? openPanel(sessionId, s.id) : undefined
          }
          className="group inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-left transition-colors hover:border-accent/50 hover:bg-accent/[0.05]"
          title={
            sessionId
              ? `查看 ${s.displayName ?? s.agentId ?? "sub-agent"} 详情`
              : "未关联 session"
          }
        >
          <Bot className="h-3 w-3 text-accent" />
          <span className="font-mono text-[10.5px] font-medium text-foreground/90">
            {s.displayName ?? s.agentId ?? "sub-agent"}
          </span>
          <PanelRightOpen className="h-3 w-3 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
        </button>
      ))}
    </div>
  );
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
      <div className="mx-auto max-w-4xl">
        {message.parts
          .map((p) => (p.type === "text" ? p.text : ""))
          .filter(Boolean)
          .join("\n")}
      </div>
    </div>
  );
}
