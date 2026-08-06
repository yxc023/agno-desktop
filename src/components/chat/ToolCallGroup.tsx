import { useState } from "react";
import { ChevronDown, Files, Layers, Check, Copy } from "lucide-react";
import { cn, copyToClipboard } from "@/lib/utils";
import type { ToolCallPart } from "@/lib/message-types";
import { ToolCallCard } from "./ToolCallCard";
import {
  pickToolIdentifier,
  formatToolCallForCopy,
  isReadLikeTool,
} from "@/lib/tool-render-utils";

interface Props {
  tools: ToolCallPart[];
}

/**
 * ToolCallGroup — 把连续 N 个 tool_call 折叠成一张可展开卡片。
 *
 * Header 模式：
 *   - "read"（全 read-like）→ "Read N files" + 路径 / query 列表（原有行为）
 *   - "mixed"               → "N 次调用" + 按 tool_name 直方图
 *                            （brief 模式 + 跨类型合并时使用）
 *
 * Brief 模式下即使全是 read-like，也走 mixed 路径（更紧凑："read_file×5"
 * 比 5 个路径挤在一起更易扫读）。
 *
 * 设计要点（保持）：
 * - 默认折叠；展开后逐个渲染 ToolCallCard。
 * - 顶部"整体拷贝"按钮把所有 N 个 call 拼成 markdown 块。
 * - 单个 call 不走 group（多一层包装不划算）；由 partitionParts 上游控制。
 */
export function ToolCallGroup({ tools }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const n = tools.length;
  const allRead = tools.every((t) => isReadLikeTool(t.toolName));

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

  const errorCount = tools.filter((t) => t.status === "error").length;

  // Header 内容
  const readHeader = (() => {
    const identifiers = tools.map((t) =>
      pickToolIdentifier(t.toolName, t.args)
    );
    const first = identifiers[0];
    const second = identifiers[1];
    const remaining = Math.max(0, n - 2);
    return { first, second, remaining };
  })();

  const mixedHeader = (() => {
    // 按 toolName 计数 → "read_file×3 · shell×2 · web_search"
    const counts = new Map<string, number>();
    for (const t of tools) {
      counts.set(t.toolName, (counts.get(t.toolName) ?? 0) + 1);
    }
    const parts: string[] = [];
    for (const [name, c] of counts) {
      parts.push(c === 1 ? name : `${name}×${c}`);
    }
    return parts.join(" · ");
  })();

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
          <span
            className={cn(
              "flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[12px]",
              anyError
                ? "bg-destructive/15 text-destructive"
                : allRead
                ? "bg-muted/60 text-muted-foreground"
                : "bg-accent/10 text-accent"
            )}
          >
            {allRead ? (
              <Files className="h-3 w-3" />
            ) : (
              <Layers className="h-3 w-3" />
            )}
          </span>

          <span className="shrink-0 text-[12.5px] font-semibold leading-none">
            {allRead ? (
              <>
                Read {n} {n === 1 ? "file" : "files"}
              </>
            ) : (
              <>{n} 次调用</>
            )}
          </span>

          <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-none text-muted-foreground/80">
            {allRead ? (
              <>
                {readHeader.first ?? "(no path)"}
                {readHeader.second && (
                  <>
                    <span className="px-1 text-muted-foreground/40">·</span>
                    {readHeader.second}
                  </>
                )}
                {readHeader.remaining > 0 && (
                  <span className="px-1 text-muted-foreground/60">
                    · +{readHeader.remaining}
                  </span>
                )}
              </>
            ) : (
              <>{mixedHeader}</>
            )}
          </span>

          {errorCount > 0 && (
            <span
              className="shrink-0 rounded bg-destructive/15 px-1.5 font-mono text-[9.5px] font-medium uppercase tracking-wider text-destructive"
              title={`${errorCount} 调用失败`}
            >
              {errorCount} fail
            </span>
          )}

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
