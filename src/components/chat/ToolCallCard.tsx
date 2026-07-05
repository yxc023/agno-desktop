import { useState } from "react";
import {
  ChevronDown,
  Wrench,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Terminal,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CodeBlock } from "@/components/markdown/CodeBlock";
import type { ToolCallPart } from "@/lib/message-types";
import { Badge } from "@/components/ui/badge";

interface Props {
  tool: ToolCallPart;
}

const TOOL_ICONS: Record<string, string> = {
  web_search: "⌕",
  web_fetch: "⇣",
  search_knowledge: "▤",
  read_file: "▢",
  write_file: "▣",
  execute_command: "$",
  list_directory: "/",
  query_my_codebase: "λ",
};

function getToolIcon(name: string) {
  return TOOL_ICONS[name] ?? "◇";
}

function getToolDisplayName(name: string) {
  return name
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

export function ToolCallCard({ tool }: Props) {
  // 总是默认折叠，不管 settings（避免 localStorage 旧值导致展开）
  // 用户可以手动展开任何一张
  const [open, setOpen] = useState(false);

  const Icon =
    tool.status === "calling"
      ? Loader2
      : tool.status === "error"
      ? XCircle
      : CheckCircle2;

  const borderClass =
    tool.status === "calling"
      ? "border-accent/30 bg-accent/[0.03]"
      : tool.status === "error"
      ? "border-destructive/30 bg-destructive/[0.04]"
      : "border-border bg-card/50";

  const iconColor =
    tool.status === "calling"
      ? "text-accent animate-spin"
      : tool.status === "error"
      ? "text-destructive"
      : "text-success";

  const hasResult = tool.result !== undefined && tool.result !== null;
  const argsCount = Object.keys(tool.args ?? {}).length;
  const duration =
    tool.durationMs != null
      ? tool.durationMs < 1000
        ? `${tool.durationMs}ms`
        : `${(tool.durationMs / 1000).toFixed(2)}s`
      : null;

  return (
    <div
      className={cn(
        "my-2 overflow-hidden rounded-md border transition-colors",
        borderClass,
        tool.status === "calling" && "scan-line"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded font-mono text-[13px]",
            tool.status === "calling"
              ? "bg-accent/15 text-accent"
              : tool.status === "error"
              ? "bg-destructive/15 text-destructive"
              : "bg-success/15 text-success"
          )}
        >
          {getToolIcon(tool.toolName)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icon className={cn("h-3 w-3 shrink-0", iconColor)} strokeWidth={2.5} />
            <span className="text-[12.5px] font-semibold">
              {getToolDisplayName(tool.toolName)}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/60">
              {tool.toolName}
            </span>
            {tool.status === "calling" && (
              <Badge variant="info" className="font-mono text-[10px]">
                running
              </Badge>
            )}
            {tool.status === "error" && (
              <Badge variant="destructive" className="font-mono text-[10px]">
                error
              </Badge>
            )}
            {duration && (
              <span className="ml-auto font-mono text-[10px] text-muted-foreground/60">
                <Clock className="h-2.5 w-2.5 inline mr-0.5" />
                {duration}
              </span>
            )}
          </div>
          {/* 折叠时显示 args 预览 + 结果摘要 */}
          {!open && (
            <div className="mt-1 space-y-0.5">
              {argsCount > 0 && (
                <div className="truncate font-mono text-[10.5px] text-muted-foreground/80">
                  {Object.entries(tool.args)
                    .slice(0, 3)
                    .map(
                      ([k, v]) =>
                        `${k}=${formatArgPreview(v, k === "objective")}`
                    )
                    .join(" · ")}
                </div>
              )}
              {hasResult && (
                <ResultSummary
                  result={tool.result}
                  toolName={tool.toolName}
                />
              )}
            </div>
          )}
        </div>

        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform text-muted-foreground/60",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="border-t border-border/50">
          {argsCount > 0 && (
            <div className="border-b border-border/30 px-3 py-2">
              <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                <Terminal className="h-2.5 w-2.5" />
                input
              </div>
              <CodeBlock
                language="json"
                value={JSON.stringify(tool.args, null, 2)}
                className="my-0"
              />
            </div>
          )}
          {tool.error && (
            <div className="border-b border-border/30 px-3 py-2">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-destructive">
                error
              </div>
              <CodeBlock
                language="text"
                value={tool.error}
                className="my-0"
              />
            </div>
          )}
          {hasResult && (
            <div className="px-3 py-2">
              <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                <CheckCircle2 className="h-2.5 w-2.5 text-success" />
                output
              </div>
              <ResultRenderer result={tool.result} toolName={tool.toolName} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatArgPreview(value: any, full = false): string {
  if (typeof value === "string") {
    if (full) {
      return `"${value.length > 60 ? value.slice(0, 60) + "…" : value}"`;
    }
    return value.length > 30 ? `"${value.slice(0, 30)}…"` : `"${value}"`;
  }
  if (Array.isArray(value)) {
    return `[${value.length}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).length}}`;
  }
  return String(value);
}

/**
 * 折叠态显示的结果摘要 —— 让用户一眼看出工具调用结果
 */
function ResultSummary({ result, toolName }: { result: any; toolName: string }) {
  // web_search: 显示找到几条结果 + 第一个标题
  if (toolName === "web_search" && Array.isArray(result)) {
    return (
      <div className="flex items-center gap-1 font-mono text-[10.5px] text-success/80">
        <span>✓ 找到 {result.length} 条结果</span>
        {result[0]?.title && (
          <span className="truncate text-muted-foreground/70">
            · {result[0].title}
          </span>
        )}
      </div>
    );
  }
  // web_fetch: 显示抓取了几个 URL
  if (toolName === "web_fetch" && Array.isArray(result)) {
    return (
      <div className="flex items-center gap-1 font-mono text-[10.5px] text-success/80">
        <span>✓ 抓取 {result.length} 个 URL</span>
      </div>
    );
  }
  // 通用：显示是 array 还是 object
  if (Array.isArray(result)) {
    return (
      <div className="font-mono text-[10.5px] text-success/80">
        ✓ 返回 {result.length} 项
      </div>
    );
  }
  if (typeof result === "object" && result !== null) {
    return (
      <div className="font-mono text-[10.5px] text-success/80">
        ✓ {Object.keys(result).length} 字段
      </div>
    );
  }
  if (typeof result === "string") {
    return (
      <div className="font-mono text-[10.5px] text-success/80 truncate">
        ✓ {result.length > 80 ? result.slice(0, 80) + "…" : result}
      </div>
    );
  }
  return null;
}

function ResultRenderer({ result, toolName }: { result: any; toolName: string }) {
  if (typeof result === "string") {
    if (result.length > 5000) {
      return (
        <CodeBlock
          language="text"
          value={result.slice(0, 5000) + `\n\n... (truncated, total ${result.length} chars)`}
          className="my-0"
        />
      );
    }
    return <CodeBlock language="text" value={result} className="my-0" />;
  }
  if (Array.isArray(result)) {
    // web_search 返回的搜索结果
    if (
      toolName === "web_search" &&
      result.length > 0 &&
      typeof result[0] === "object" &&
      (result[0].title || result[0].url)
    ) {
      return (
        <div className="space-y-1.5">
          {result.slice(0, 8).map((r: any, i: number) => (
            <a
              key={i}
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="group/link flex gap-2.5 rounded border border-border/40 px-2.5 py-2 transition-colors hover:border-accent/40 hover:bg-accent/[0.04]"
            >
              <span className="font-mono text-[10px] text-muted-foreground/50 group-hover/link:text-accent">
                [{String(i + 1).padStart(2, "0")}]
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[12.5px] font-medium text-foreground group-hover/link:text-accent">
                    {r.title || r.url}
                  </span>
                  <ExternalLink className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" />
                </div>
                {r.snippet || r.excerpt || r.content ? (
                  <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground/80">
                    {(r.snippet || r.excerpt || r.content || "")
                      .replace(/\s+/g, " ")
                      .slice(0, 180)}
                  </div>
                ) : null}
                {r.publish_date && (
                  <div className="mt-1 font-mono text-[10px] text-muted-foreground/60">
                    {r.publish_date}
                  </div>
                )}
              </div>
            </a>
          ))}
          {result.length > 8 && (
            <div className="pt-1 text-center font-mono text-[10.5px] text-muted-foreground/60">
              +{result.length - 8} more
            </div>
          )}
        </div>
      );
    }
    return (
      <CodeBlock
        language="json"
        value={JSON.stringify(result, null, 2)}
        className="my-0"
      />
    );
  }
  if (typeof result === "object") {
    return (
      <CodeBlock
        language="json"
        value={JSON.stringify(result, null, 2)}
        className="my-0"
      />
    );
  }
  return <CodeBlock language="text" value={String(result)} className="my-0" />;
}