import { useState } from "react";
import { ChevronDown, Files, Check, Copy } from "lucide-react";
import { cn, copyToClipboard } from "@/lib/utils";
import type { ToolCallPart } from "@/lib/message-types";
import { ToolCallCard } from "./ToolCallCard";
import { pickToolIdentifier, formatToolCallForCopy } from "@/lib/tool-render-utils";

interface Props {
  tools: ToolCallPart[];
}

/**
 * ToolCallGroup — 把连续 N 个 read-like tool_call 折叠成一张卡片。
 *
 * 设计要点：
 * - 默认折叠。header 显示"Read N files" + 每个 tool 的标识（文件路径 / query），
 *   让用户一眼看出 agent 读了哪些东西。
 * - 展开后逐个渲染 `ToolCallCard`（保持单卡渲染逻辑只写一份）。
 * - 顶部有一个"整体拷贝"按钮，把所有 N 个 call 拼成 markdown 块，方便分享。
 *
 * 触发条件：上游（MessageContent）只在连续 ≥ 2 个 read-like 时才包成 group，
 * 否则仍然走 `ToolCallCard` 直渲染 —— 单个 call 不值得多一层包装。
 */
export function ToolCallGroup({ tools }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const n = tools.length;
  const identifiers = tools.map((t) => pickToolIdentifier(t.toolName, t.args));
  // 显示用：第一个 + 剩余省略号
  const first = identifiers[0];
  const second = identifiers[1];
  const remaining = Math.max(0, n - 2);

  // 任一调用还在 running / error 时，沿用相同的 border 样式
  const anyCalling = tools.some((t) => t.status === "calling");
  const anyError = tools.some((t) => t.status === "error");
  const borderClass = anyError
    ? "border-destructive/30 bg-destructive/[0.04]"
    : anyCalling
    ? "border-accent/30 bg-accent/[0.03]"
    : "border-border bg-card/40";

  const allDuration = tools.reduce(
    (sum, t) => sum + (t.durationMs ?? 0),
    0
  );
  const durationLabel =
    allDuration === 0
      ? null
      : allDuration < 1000
      ? `${allDuration}ms`
      : `${(allDuration / 1000).toFixed(2)}s`;

  async function handleCopyAll(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const blocks = tools.map((t) => formatToolCallForCopy(t));
    const text = blocks.join("\n\n---\n\n");
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div
      className={cn(
        "group/group my-1.5 overflow-hidden rounded-md border transition-colors",
        borderClass
      )}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted/60 font-mono text-[12px] text-muted-foreground">
            <Files className="h-3 w-3" />
          </span>

          <span className="shrink-0 text-[12.5px] font-semibold leading-none">
            Read {n} {n === 1 ? "file" : "files"}
          </span>

          <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-none text-muted-foreground/80">
            {first ?? "(no path)"}
            {second && (
              <>
                <span className="px-1 text-muted-foreground/40">·</span>
                {second}
              </>
            )}
            {remaining > 0 && (
              <span className="px-1 text-muted-foreground/60">
                · +{remaining}
              </span>
            )}
          </span>

          {durationLabel && (
            <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground/60 sm:inline">
              {durationLabel}
            </span>
          )}

          <ChevronDown
            className={cn(
              "h-3 w-3 shrink-0 transition-transform text-muted-foreground/50",
              open && "rotate-180"
            )}
          />
        </button>

        <button
          type="button"
          onClick={handleCopyAll}
          title={`复制全部 ${n} 个工具调用`}
          aria-label="复制全部工具调用"
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 transition-all hover:bg-foreground/[0.06] hover:text-foreground",
            "opacity-0 group-hover/group:opacity-100",
            copied && "text-success opacity-100"
          )}
        >
          {copied ? (
            <Check className="h-2.5 w-2.5" />
          ) : (
            <Copy className="h-2.5 w-2.5" />
          )}
        </button>
      </div>

      {open && (
        <div className="border-t border-border/40 bg-background/30 px-2.5 py-2">
          <div className="space-y-1.5">
            {tools.map((tool, i) => (
              <ToolCallCard key={tool.toolCallId || i} tool={tool} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
