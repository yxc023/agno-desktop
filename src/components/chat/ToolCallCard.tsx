import { useState } from "react";
import {
  ChevronDown,
  ExternalLink,
  Copy,
  Check,
  FileText,
} from "lucide-react";
import { cn, copyToClipboard } from "@/lib/utils";
import { CodeBlock } from "@/components/markdown/CodeBlock";
import { openExternalUrl } from "@/lib/open-external-url";
import type { ToolCallPart } from "@/lib/message-types";
import {
  pickCommand,
  pickCwd,
  pickShellOutput,
  inferLang,
  truncateText,
  computeLcs,
  formatToolCallForCopy,
  unwrapToolResult,
  parseToolResultStringified,
} from "@/lib/tool-render-utils";

interface Props {
  tool: ToolCallPart;
}

const TOOL_ICONS: Record<string, string> = {
  web_search: "⌕",
  web_fetch: "⇣",
  search_knowledge: "▤",
  read_file: "▢",
  write_file: "▣",
  edit_file: "✎",
  execute_command: "$",
  run_command: "$",
  shell: "$",
  list_directory: "/",
  query_my_codebase: "λ",
};

const SHELL_TOOLS = new Set([
  "execute_command",
  "run_command",
  "shell",
  "bash",
]);

function getToolIcon(name: string) {
  return TOOL_ICONS[name] ?? "◇";
}

function getToolDisplayName(name: string) {
  return name
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

/**
 * 一行摘要 —— 给折叠态 header 用。
 *
 * 优先级：
 *  1. shell 工具 → 直接显示命令（用户最关心的就是"跑了啥"）
 *  2. 文件读写 / 编辑 / 列目录 → 显示路径
 *  3. 通用 → key=value 缩略
 */
function toolOneLineSummary(tool: ToolCallPart): string | null {
  const name = tool.toolName;
  const args = tool.args;

  if (SHELL_TOOLS.has(name)) {
    const cmd = pickCommand(args);
    if (cmd) return cmd;
  }

  if (
    name === "read_file" ||
    name === "write_file" ||
    name === "edit_file" ||
    name === "list_directory"
  ) {
    const path = args?.file_path ?? args?.path ?? args?.directory;
    if (typeof path === "string" && path.length > 0) return path;
  }

  if (name === "web_search" || name === "search_knowledge") {
    const q = args?.query ?? args?.q;
    if (typeof q === "string" && q.length > 0) return q;
  }

  if (name === "web_fetch") {
    const u = args?.url;
    if (typeof u === "string" && u.length > 0) return u;
  }

  if (args && typeof args === "object") {
    const entries = Object.entries(args)
      .filter(([k]) => !["command", "cmd", "shell_command", "script"].includes(k))
      .slice(0, 3);
    if (entries.length === 0) return null;
    return entries
      .map(([k, v]) => `${k}=${formatArgPreview(v)}`)
      .join(" · ");
  }
  return null;
}

export function ToolCallCard({ tool }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const borderClass =
    tool.status === "calling"
      ? "border-accent/30 bg-accent/[0.03]"
      : tool.status === "error"
      ? "border-destructive/30 bg-destructive/[0.04]"
      : "border-border bg-card/40";

  const duration =
    tool.durationMs != null
      ? tool.durationMs < 1000
        ? `${tool.durationMs}ms`
        : `${(tool.durationMs / 1000).toFixed(2)}s`
      : null;

  const summary = toolOneLineSummary(tool);

  async function handleCopyAll(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const ok = await copyToClipboard(formatToolCallForCopy(tool));
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div
      className={cn(
        "group/tool my-1.5 overflow-hidden rounded-md border transition-colors",
        borderClass,
        tool.status === "calling" && "scan-line"
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
              tool.status === "calling"
                ? "bg-accent/15 text-accent"
                : tool.status === "error"
                ? "bg-destructive/15 text-destructive"
                : "bg-success/15 text-success"
            )}
          >
            {getToolIcon(tool.toolName)}
          </span>

          <span className="shrink-0 text-[12.5px] font-semibold leading-none">
            {getToolDisplayName(tool.toolName)}
          </span>

          {summary && (
            <span
              className={cn(
                "min-w-0 flex-1 truncate font-mono text-[11px] leading-none",
                SHELL_TOOLS.has(tool.toolName)
                  ? "text-foreground/85"
                  : "text-muted-foreground/80"
              )}
              title={summary}
            >
              {SHELL_TOOLS.has(tool.toolName) && "$ "}
              {summary}
            </span>
          )}

          {duration && (
            <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground/60 sm:inline">
              {duration}
            </span>
          )}

          <ChevronDown
            className={cn(
              "h-3 w-3 shrink-0 transition-transform text-muted-foreground/50",
              open && "rotate-180"
            )}
          />
        </button>

        {/* 拷贝按钮 —— hover 才显现，默认 0 透明度；保持常驻 button 的可访问性 */}
        <button
          type="button"
          onClick={handleCopyAll}
          title="复制整个工具调用"
          aria-label="复制整个工具调用"
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 transition-all hover:bg-foreground/[0.06] hover:text-foreground",
            "opacity-0 group-hover/tool:opacity-100",
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
        <div className="border-t border-border/40 bg-background/30">
          <ExpandedToolBody tool={tool} />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* 展开态内容                                                         */
/* ---------------------------------------------------------------- */

function ExpandedToolBody({ tool }: { tool: ToolCallPart }) {
  const name = tool.toolName;
  const hasArgs = tool.args && Object.keys(tool.args).length > 0;
  const hasError = !!tool.error;
  const hasResult =
    tool.result !== undefined && tool.result !== null && tool.result !== "";

  // shell 工具：命令块 + 输出。OUTPUT 段无条件渲染（空 result 也显示占位），
  // 用户不会看到一张空白展开卡。
  if (SHELL_TOOLS.has(name)) {
    const cmd = pickCommand(tool.args);
    const cwd = pickCwd(tool.args);
    return (
      <div className="space-y-1.5 px-2.5 py-2">
        {cmd && (
          <div className="space-y-1">
            {cwd && (
              <div className="font-mono text-[10px] text-muted-foreground/60">
                in {cwd}
              </div>
            )}
            <CodeBlock language="bash" value={cmd} className="my-0" />
          </div>
        )}
        {hasError && (
          <CodeBlock
            language="text"
            value={tool.error ?? ""}
            className="my-0"
          />
        )}
        <OutputSection>
          <ShellResultRenderer result={tool.result} status={tool.status} />
        </OutputSection>
      </div>
    );
  }

  // 文件编辑：path + diff + OUTPUT（diff 已经是 args 渲染，OUTPUT 单独给 result）
  if (name === "edit_file" || name === "str_replace" || name === "edit") {
    return (
      <div className="space-y-1.5 px-2.5 py-2">
        <EditBody tool={tool} />
        {hasError && (
          <CodeBlock
            language="text"
            value={tool.error ?? ""}
            className="my-0"
          />
        )}
        <OutputSection
          showPlaceholder={!hasResult}
          placeholderText={
            tool.status === "error" ? "(failed)" : "(no output)"
          }
        >
          <GenericResultRenderer tool={tool} />
        </OutputSection>
      </div>
    );
  }

  // 写文件：path + content（来自 args）+ OUTPUT（来自 result）
  if (name === "write_file") {
    return (
      <div className="space-y-1.5 px-2.5 py-2">
        <WriteBody tool={tool} />
        {hasError && (
          <CodeBlock
            language="text"
            value={tool.error ?? ""}
            className="my-0"
          />
        )}
        <OutputSection
          showPlaceholder={!hasResult}
          placeholderText={
            tool.status === "error" ? "(failed)" : "(no output)"
          }
        >
          <GenericResultRenderer tool={tool} />
        </OutputSection>
      </div>
    );
  }

  // 读文件：path + content（content 即 result）—— 内容以 OUTPUT 标签显示
  if (name === "read_file") {
    return (
      <div className="space-y-1.5 px-2.5 py-2">
        <ReadBodyHeader tool={tool} />
        {hasError && (
          <CodeBlock
            language="text"
            value={tool.error ?? ""}
            className="my-0"
          />
        )}
        <OutputSection
          showPlaceholder={!hasResult}
          placeholderText={
            tool.status === "error" ? "(failed)" : "(no content)"
          }
        >
          <ReadBodyContent tool={tool} />
        </OutputSection>
      </div>
    );
  }

  // 通用：args + error + OUTPUT（OUTPUT 段始终有，result 缺失时显示占位）
  return (
    <div className="space-y-1.5 px-2.5 py-2">
      {hasArgs && <KeyValueTable args={tool.args} />}
      {hasError && (
        <CodeBlock
          language="text"
          value={tool.error ?? ""}
          className="my-0"
        />
      )}
      <OutputSection
        showPlaceholder={!hasResult}
        placeholderText={
          tool.status === "error" ? "(failed)" : "(no output)"
        }
      >
        <GenericResultRenderer tool={tool} />
      </OutputSection>
    </div>
  );
}

/**
 * 通用 OUTPUT 段 —— 任何工具展开时都有"输出"区域，无 result 时显示占位文案。
 *
 * 之前 read_file / write_file / 通用 路径都有 `{hasResult && <Renderer/>}`，
 * 缺 result 时不渲染 —— 用户看到一张空白卡片的某部分，怀疑"返回去哪了"。
 * 统一把 OUTPUT 段做成 always-render，placeholder 让"无返回" vs "有返回" 显式可辨。
 */
function OutputSection({
  children,
  showPlaceholder,
  placeholderText = "(no output)",
}: {
  children: React.ReactNode;
  /**
   * 强制显示占位文案（即使 children 自身能渲染）。
   * 用于 hasResult 为 false 但仍想给用户"这里是空"的明确信号的场景；
   * shell 工具自己有更复杂的渲染（stdout/stderr/exit），不传这个 —— 没有
   * result 时 ShellResultRenderer 内部已经显示 "(no output)"。
   */
  showPlaceholder?: boolean;
  placeholderText?: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
        <CheckCircle2Icon />
        output
      </div>
      {showPlaceholder ? (
        <div className="font-mono text-[10.5px] text-muted-foreground/60">
          {placeholderText}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function CheckCircle2Icon() {
  // 极简的内联 icon —— Tailwind 4 没把 check 一起打包，避免再添一个 import。
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      className="text-success"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function EditBody({ tool }: { tool: ToolCallPart }) {
  const args = tool.args;
  const path = args?.file_path ?? args?.path;
  const oldStr =
    args?.old_string ?? args?.old_text ?? args?.before ?? args?.find;
  const newStr =
    args?.new_string ?? args?.new_text ?? args?.after ?? args?.replace;
  const content = args?.content;

  const renderBody = () => {
    if (oldStr !== undefined && newStr !== undefined) {
      return <DiffView before={String(oldStr)} after={String(newStr)} />;
    }
    if (content !== undefined) {
      return (
        <CodeBlock
          language={path ? inferLang(path) : "text"}
          value={String(content)}
          className="my-0"
        />
      );
    }
    return <KeyValueTable args={args} />;
  };

  return (
    <div className="space-y-1.5">
      {path && <FilePathChip path={path} />}
      {renderBody()}
    </div>
  );
}

function WriteBody({ tool }: { tool: ToolCallPart }) {
  const args = tool.args;
  const path = args?.file_path ?? args?.path;
  const content = args?.content ?? args?.text;
  return (
    <>
      {path && <FilePathChip path={path} />}
      {typeof content === "string" ? (
        <CodeBlock
          language={inferLang(path ?? "")}
          value={content}
          className="my-0"
        />
      ) : (
        <KeyValueTable args={args} />
      )}
    </>
  );
}

function ReadBodyHeader({ tool }: { tool: ToolCallPart }) {
  const path = tool.args?.file_path ?? tool.args?.path;
  return path ? <FilePathChip path={path} /> : null;
}

function ReadBodyContent({ tool }: { tool: ToolCallPart }) {
  const args = tool.args;
  const path = args?.file_path ?? args?.path;
  const result = tool.result;
  if (result === undefined || result === null) return null;
  if (typeof result === "string") {
    return (
      <CodeBlock
        language={inferLang(path ?? "")}
        value={truncateText(result, 20000)}
        className="my-0"
      />
    );
  }
  // 对象 / 数组：JSON 化兜底
  return (
    <CodeBlock
      language="json"
      value={JSON.stringify(result, null, 2)}
      className="my-0"
    />
  );
}

/* ---------------------------------------------------------------- */
/* FilePathChip — 文件路径 header（取代之前大块的 path card）           */
/* ---------------------------------------------------------------- */

function FilePathChip({ path }: { path: string }) {
  return (
    <div className="flex items-center gap-1.5 truncate font-mono text-[10.5px] text-muted-foreground/80">
      <FileText className="h-2.5 w-2.5 shrink-0" />
      <span className="truncate">{path}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* KeyValueTable — 通用参数表格                                       */
/* ---------------------------------------------------------------- */

function KeyValueTable({ args }: { args: any }) {
  if (!args || typeof args !== "object") return null;
  const entries = Object.entries(args);
  if (entries.length === 0) return null;
  return (
    <div className="overflow-hidden rounded border border-border/50">
      <table className="w-full font-mono text-[10.5px]">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="border-b border-border/30 last:border-b-0">
              <td className="w-[35%] max-w-[140px] shrink-0 truncate bg-muted/30 px-2 py-0.5 align-top text-muted-foreground/80">
                {k}
              </td>
              <td className="break-all px-2 py-0.5 align-top text-foreground/90">
                {typeof v === "string" ? (
                  v
                ) : (
                  <code>{JSON.stringify(v)}</code>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Diff 视图（line-level LCS）                                       */
/* ---------------------------------------------------------------- */

function DiffView({ before, after }: { before: string; after: string }) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const ops = computeLcs(beforeLines, afterLines);

  const rendered: Array<{ type: "context" | "del" | "add"; text: string }> = [];
  let bi = 0;
  let ai = 0;
  for (const op of ops) {
    if (op === "=") {
      rendered.push({ type: "context", text: beforeLines[bi++] });
      ai++;
    } else if (op === "-") {
      rendered.push({ type: "del", text: beforeLines[bi++] });
    } else if (op === "+") {
      rendered.push({ type: "add", text: afterLines[ai++] });
    }
  }

  return (
    <div className="overflow-hidden rounded border border-border/50 font-mono text-[11px]">
      <div className="max-h-[400px] overflow-auto">
        {rendered.map((op, i) => (
          <div
            key={i}
            className={cn(
              "flex items-start gap-2 border-b border-border/20 px-2 py-0.5 last:border-b-0",
              op.type === "del" && "bg-destructive/[0.06] text-destructive/90",
              op.type === "add" && "bg-success/[0.06] text-success/90"
            )}
          >
            <span
              className={cn(
                "w-3 shrink-0 select-none text-center",
                op.type === "del" && "text-destructive/70",
                op.type === "add" && "text-success/70",
                op.type === "context" && "text-muted-foreground/30"
              )}
            >
              {op.type === "del" ? "-" : op.type === "add" ? "+" : " "}
            </span>
            <pre className="m-0 flex-1 whitespace-pre-wrap break-all">
              {op.text || "\u00A0"}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Shell 结果：stdout / stderr / exit_code                            */
/* ---------------------------------------------------------------- */

function ShellResultRenderer({
  result,
  status,
}: {
  result: any;
  status: ToolCallPart["status"];
}) {
  // 还在跑：占位文案，明确告诉用户"还没输出"，避免他们以为工具出错了。
  if (status === "calling") {
    return (
      <div className="font-mono text-[10.5px] text-muted-foreground/60">
        (running, no output yet)
      </div>
    );
  }

  // 无 result：兜底占位
  if (result === undefined || result === null) {
    return (
      <div className="font-mono text-[10.5px] text-muted-foreground/60">
        (no output)
      </div>
    );
  }

  // pickShellOutput 归一化各种 AGNO shell result 形态 —— 同时覆盖顶层字符串、
  // 顶层数组、{stdout, exit_code} / {output, exitCode} / {result, exit_code} /
  // Anthropic-style content 数组等。
  const parsed = pickShellOutput(result);
  const stdout = parsed.stdout ?? "";
  const stderr = parsed.stderr ?? "";
  const exit = parsed.exit;

  // 全部归一化失败（pickShellOutput 没认出任何字段） → 原始数据兜底显示，
  // 而不是悄悄空白。这是用户反馈"明明有结果却看不到"的最后一道防线。
  const allEmpty =
    stdout.length === 0 && stderr.length === 0 && exit === undefined;

  return (
    <div className="space-y-1.5">
      {exit !== undefined && (
        <div
          className={cn(
            "font-mono text-[10px]",
            exit === 0 ? "text-muted-foreground/70" : "text-destructive/80"
          )}
        >
          exit {exit}
        </div>
      )}
      {stdout.length > 0 && (
        <CodeBlock
          language="bash"
          value={truncateText(stdout, 20000)}
          className="my-0"
        />
      )}
      {stderr.length > 0 && (
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-destructive/80">
            stderr
          </div>
          <CodeBlock
            language="bash"
            value={truncateText(stderr, 20000)}
            className="my-0"
          />
        </div>
      )}
      {allEmpty && (
        // 兜底：把 result 原文展示出来（text 走 ``` 块、对象走 JSON 块）。
        // 这样不管 AGNO 返回什么奇怪 shape，用户都看得到。
        <>
          {typeof result === "string" ? (
            <CodeBlock
              language="text"
              value={truncateText(result, 20000)}
              className="my-0"
            />
          ) : (
            <CodeBlock
              language="json"
              value={JSON.stringify(result, null, 2)}
              className="my-0"
            />
          )}
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* 通用 result renderer（适用于未知 tool）                            */
/* ---------------------------------------------------------------- */

function GenericResultRenderer({ tool }: { tool: ToolCallPart }) {
  const name = tool.toolName;

  // 关键修复：AGNO 上行 `tc.result` 是 JSON 字符串，ChatRunner 已经 parse 过一次
  // （→ e.g. `{results:[...],search_id:"..."}`）。但不同工具把数据放在不同 key
  // 里 —— 之前只看 `Array.isArray(result)`，碰到 wrapper 对象就 fallback 到
  // JSON dump，让用户看到 `{"results":[...],"search_id":"..."}` 而非真正的
  // 结果列表。这里先把 JSON 字符串二次 parse（冗余 safety），再尝试解开
  // 常见 wrapper key（results / files / items / data / output / content），
  // 把有意义的数组 / 字符串 / 对象渲染出来。
  let result = parseToolResultStringified(tool.result);
  const { payload, unwrapped, wrapperKey } = unwrapToolResult(result);
  if (unwrapped) result = payload;

  if (typeof result === "string") {
    if (result.length > 5000) {
      return (
        <CodeBlock
          language="text"
          value={
            result.slice(0, 5000) +
            `\n\n... (truncated, total ${result.length} chars)`
          }
          className="my-0"
        />
      );
    }
    return <CodeBlock language="text" value={result} className="my-0" />;
  }

  if (Array.isArray(result)) {
    // search 风格工具（web_search / web_fetch / search_knowledge）：条目有
    // {url, title, ...} 时渲染成可点击链接列表。
    const isLinkList =
      name === "web_search" ||
      name === "web_fetch" ||
      (name === "search_knowledge" && result.length > 0);
    if (
      isLinkList &&
      result.length > 0 &&
      typeof result[0] === "object" &&
      (result[0].title || result[0].url)
    ) {
      return (
        <div className="space-y-1">
          {result.slice(0, 8).map((r: any, i: number) => (
            <a
              key={i}
              href={r.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void openExternalUrl(r.url);
              }}
              className="group/link flex gap-2 rounded border border-border/40 px-2 py-1.5 transition-colors hover:border-accent/40 hover:bg-accent/[0.04]"
            >
              <span className="font-mono text-[10px] text-muted-foreground/50 group-hover/link:text-accent">
                [{String(i + 1).padStart(2, "0")}]
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[12px] font-medium text-foreground group-hover/link:text-accent">
                    {r.title || r.url}
                  </span>
                  <ExternalLink className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" />
                </div>
                {(r.snippet || r.excerpt || r.content) && (
                  <div className="mt-0.5 line-clamp-2 text-[10.5px] text-muted-foreground/80">
                    {(r.snippet || r.excerpt || r.content || "")
                      .replace(/\s+/g, " ")
                      .slice(0, 180)}
                  </div>
                )}
              </div>
            </a>
          ))}
          {result.length > 8 && (
            <div className="pt-0.5 text-center font-mono text-[10px] text-muted-foreground/60">
              +{result.length - 8} more
            </div>
          )}
        </div>
      );
    }
    // 列表 / 文件数组（list_files / query_my_codebase）：展示成 monospace
    // 路径 / 标识列表 —— 比 JSON 更易读。
    const looksLikeFileList =
      name === "list_files" ||
      name === "query_my_codebase" ||
      (result[0] && typeof result[0] === "object" && "path" in result[0]);
    if (looksLikeFileList) {
      return (
        <div className="overflow-hidden rounded border border-border/50">
          {result.slice(0, 50).map((r: any, i: number) => (
            <div
              key={i}
              className="flex items-center gap-2 border-b border-border/30 px-2 py-0.5 font-mono text-[10.5px] last:border-b-0"
            >
              <span className="w-3 shrink-0 text-center text-muted-foreground/50">
                {r.type === "dir" ? "📁" : "·"}
              </span>
              <span className="truncate text-foreground/90">
                {r.path ?? r.name ?? String(r)}
              </span>
              {r.size != null && (
                <span className="ml-auto shrink-0 text-muted-foreground/60">
                  {r.size}
                </span>
              )}
            </div>
          ))}
          {result.length > 50 && (
            <div className="border-t border-border/30 px-2 py-0.5 text-center font-mono text-[10px] text-muted-foreground/60">
              +{result.length - 50} more
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

  if (typeof result === "object" && result !== null) {
    // 无可识别的 wrapper —— 显示原始 JSON，至少比空白强。
    // wrapperKey 给出提示（开发期可见，prod 用户也能猜到"工具返回结构变了"）
    return (
      <div className="space-y-1">
        {wrapperKey && (
          <div className="font-mono text-[10px] text-muted-foreground/60">
            unwrapped from .{wrapperKey}
          </div>
        )}
        <CodeBlock
          language="json"
          value={JSON.stringify(result, null, 2)}
          className="my-0"
        />
      </div>
    );
  }

  return <CodeBlock language="text" value={String(result)} className="my-0" />;
}

/* ---------------------------------------------------------------- */
/* helpers                                                            */
/* ---------------------------------------------------------------- */

function formatArgPreview(value: any): string {
  if (typeof value === "string") {
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
