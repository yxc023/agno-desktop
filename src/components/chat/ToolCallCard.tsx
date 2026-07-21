import { useState } from "react";
import {
  ChevronDown,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Terminal,
  ExternalLink,
  Copy,
  Check,
  FileText,
  Pencil,
  FolderOpen,
  FilePlus2,
  Search,
} from "lucide-react";
import { cn, copyToClipboard } from "@/lib/utils";
import { CodeBlock } from "@/components/markdown/CodeBlock";
import { openExternalUrl } from "@/lib/open-external-url";
import type { ToolCallPart } from "@/lib/message-types";
import { Badge } from "@/components/ui/badge";
import {
  pickCommand,
  inferLang,
  truncateText,
  computeLcs,
  formatToolCallForCopy,
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
  shell: "$",
  list_directory: "/",
  query_my_codebase: "λ",
};

const TOOL_LUCIDE_ICONS: Record<string, typeof Terminal> = {
  execute_command: Terminal,
  shell: Terminal,
  read_file: FileText,
  write_file: FilePlus2,
  edit_file: Pencil,
  list_directory: FolderOpen,
  web_search: Search,
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
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

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

  // 整体拷贝：tool name + args + result + error 拼成可读的 markdown 文本
  async function handleCopyAll(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const text = formatToolCallForCopy(tool);
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  return (
    <div
      className={cn(
        "my-2 overflow-hidden rounded-md border transition-colors",
        borderClass,
        tool.status === "calling" && "scan-line"
      )}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left transition-colors hover:bg-white/[0.02] -mx-3 -my-2.5 px-3 py-2.5"
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
                  <ToolSummaryArgs tool={tool} />
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

        {/* 整体拷贝按钮 —— 与 toggle 兄弟节点，避免嵌套 button */}
        <button
          type="button"
          onClick={handleCopyAll}
          title="复制整个工具调用（名称 + 参数 + 结果）"
          aria-label="复制整个工具调用"
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-foreground/[0.06] hover:text-foreground",
            copied && "text-success"
          )}
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>

      {open && (
        <div className="border-t border-border/50">
          {argsCount > 0 && (
            <div className="border-b border-border/30 px-3 py-2">
              <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
                <ArgsHeaderIcon toolName={tool.toolName} />
                input
              </div>
              <ToolArgsRenderer tool={tool} />
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
              <ResultRenderer result={tool.result} tool={tool} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* 折叠态 args 预览                                                  */
/* ---------------------------------------------------------------- */

function ToolSummaryArgs({ tool }: { tool: ToolCallPart }) {
  const name = tool.toolName;

  // shell 命令：直接显示命令
  if (name === "execute_command" || name === "shell") {
    const cmd = pickCommand(tool.args);
    if (cmd) {
      return (
        <div className="truncate font-mono text-[10.5px] text-foreground/80">
          <span className="text-muted-foreground/60">$ </span>
          {cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd}
        </div>
      );
    }
  }

  // 文件读写 / 编辑：显示路径
  if (
    name === "read_file" ||
    name === "write_file" ||
    name === "edit_file" ||
    name === "list_directory"
  ) {
    const path = tool.args?.file_path ?? tool.args?.path ?? tool.args?.directory;
    if (path) {
      return (
        <div className="truncate font-mono text-[10.5px] text-foreground/80">
          {path}
        </div>
      );
    }
  }

  // 通用：按 key=value 缩略
  const entries = Object.entries(tool.args).slice(0, 3);
  return (
    <div className="truncate font-mono text-[10.5px] text-muted-foreground/80">
      {entries.map(([k, v]) => `${k}=${formatArgPreview(v)}`).join(" · ")}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* 展开态：tool-specific args 渲染                                    */
/* ---------------------------------------------------------------- */

function ArgsHeaderIcon({ toolName }: { toolName: string }) {
  const LucideIcon = TOOL_LUCIDE_ICONS[toolName];
  if (LucideIcon) {
    return <LucideIcon className="h-2.5 w-2.5" />;
  }
  return <Terminal className="h-2.5 w-2.5" />;
}

function ToolArgsRenderer({ tool }: { tool: ToolCallPart }) {
  const name = tool.toolName;

  // shell 命令：command 单飞显示，剩余 args 走 key-value
  if (name === "execute_command" || name === "shell") {
    const cmd = pickCommand(tool.args);
    const rest = { ...tool.args };
    delete rest.command;
    delete rest.cmd;
    delete rest.shell_command;

    return (
      <div className="space-y-2">
        {cmd && (
          <CodeBlock
            language="bash"
            value={cmd}
            className="my-0"
          />
        )}
        {Object.keys(rest).length > 0 && (
          <KeyValueTable args={rest} />
        )}
      </div>
    );
  }

  // 文件编辑：尝试渲染 old → new diff；否则回退到 JSON
  if (name === "edit_file" || name === "str_replace" || name === "edit") {
    return <EditArgsRenderer args={tool.args} />;
  }

  // 写文件：file_path 单独飞 + content 走代码块
  if (name === "write_file") {
    const path = tool.args?.file_path ?? tool.args?.path;
    const content = tool.args?.content ?? tool.args?.text;
    const lang = path ? inferLang(path) : "text";
    return (
      <div className="space-y-2">
        {path && <FilePathHeader path={path} />}
        {typeof content === "string" ? (
          <CodeBlock language={lang} value={content} className="my-0" />
        ) : (
          <KeyValueTable args={tool.args} />
        )}
      </div>
    );
  }

  // 读文件 / 列目录：只显示路径
  if (name === "read_file" || name === "list_directory") {
    const path =
      tool.args?.file_path ?? tool.args?.path ?? tool.args?.directory;
    return (
      <div className="space-y-2">
        {path && <FilePathHeader path={path} />}
        <KeyValueTable
          args={Object.fromEntries(
            Object.entries(tool.args).filter(
              ([k]) => k !== "file_path" && k !== "path" && k !== "directory"
            )
          )}
        />
      </div>
    );
  }

  // 兜底：JSON
  return (
    <CodeBlock
      language="json"
      value={JSON.stringify(tool.args, null, 2)}
      className="my-0"
    />
  );
}

function EditArgsRenderer({ args }: { args: any }) {
  const path = args?.file_path ?? args?.path;
  const oldStr =
    args?.old_string ?? args?.old_text ?? args?.before ?? args?.find;
  const newStr =
    args?.new_string ?? args?.new_text ?? args?.after ?? args?.replace;
  const content = args?.content;

  return (
    <div className="space-y-2">
      {path && <FilePathHeader path={path} />}
      {oldStr !== undefined && newStr !== undefined ? (
        <DiffView before={String(oldStr)} after={String(newStr)} />
      ) : content !== undefined ? (
        <CodeBlock
          language={path ? inferLang(path) : "text"}
          value={String(content)}
          className="my-0"
        />
      ) : (
        <CodeBlock
          language="json"
          value={JSON.stringify(args, null, 2)}
          className="my-0"
        />
      )}
    </div>
  );
}

function FilePathHeader({ path }: { path: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5">
      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate font-mono text-[11px] text-foreground/90">
        {path}
      </span>
    </div>
  );
}

function KeyValueTable({ args }: { args: Record<string, any> }) {
  const entries = Object.entries(args);
  if (entries.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-md border border-border/60">
      <table className="w-full font-mono text-[11px]">
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="border-b border-border/40 last:border-b-0">
              <td className="w-[35%] max-w-[160px] shrink-0 truncate bg-muted/30 px-2 py-1 align-top text-muted-foreground/80">
                {k}
              </td>
              <td className="break-all px-2 py-1 align-top text-foreground/90">
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
/* Diff 视图（简易行级 unified diff）                                  */
/* ---------------------------------------------------------------- */

function DiffView({ before, after }: { before: string; after: string }) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  // 极简 LCS：对短文件足够快；长文件退化为"全显示"也不致命
  const lcs = computeLcs(beforeLines, afterLines);

  const ops: Array<{ type: "context" | "del" | "add"; text: string }> = [];
  let bi = 0;
  let ai = 0;
  for (const op of lcs) {
    if (op === "=") {
      ops.push({ type: "context", text: beforeLines[bi++] });
      ai++;
    } else if (op === "-") {
      ops.push({ type: "del", text: beforeLines[bi++] });
    } else if (op === "+") {
      ops.push({ type: "add", text: afterLines[ai++] });
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-border/60 font-mono text-[11px]">
      <div className="max-h-[400px] overflow-auto">
        {ops.map((op, i) => (
          <div
            key={i}
            className={cn(
              "flex items-start gap-2 border-b border-border/30 px-2 py-0.5 last:border-b-0",
              op.type === "del" && "bg-destructive/[0.06] text-destructive/90",
              op.type === "add" && "bg-success/[0.06] text-success/90"
            )}
          >
            <span
              className={cn(
                "w-3 shrink-0 select-none text-center",
                op.type === "del" && "text-destructive/70",
                op.type === "add" && "text-success/70",
                op.type === "context" && "text-muted-foreground/40"
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

/**
 * （computeLcs 已抽出到 src/lib/tool-render-utils.ts 供单测）
 */

/* ---------------------------------------------------------------- */
/* 折叠态结果摘要                                                    */
/* ---------------------------------------------------------------- */

function ResultSummary({ result, toolName }: { result: any; toolName: string }) {
  // shell 命令：看 exit code + 行数
  if (toolName === "execute_command" || toolName === "shell") {
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const exit = result.exit_code ?? result.exitCode ?? result.code;
      const stdout = result.stdout ?? result.output;
      const stderr = result.stderr;
      const out = typeof stdout === "string" ? stdout : "";
      const err = typeof stderr === "string" ? stderr : "";
      const lines = (out + "\n" + err).split("\n").filter(Boolean).length;
      return (
        <div className="flex items-center gap-2 font-mono text-[10.5px]">
          {exit === 0 || exit === undefined ? (
            <span className="text-success/80">✓ exit 0</span>
          ) : (
            <span className="text-destructive/80">✗ exit {String(exit)}</span>
          )}
          {lines > 0 && (
            <span className="text-muted-foreground/70">· {lines} 行输出</span>
          )}
        </div>
      );
    }
    if (typeof result === "string") {
      const lines = result.split("\n").filter(Boolean).length;
      return (
        <div className="font-mono text-[10.5px] text-success/80">
          ✓ {lines > 0 ? `${lines} 行输出` : "完成"}
        </div>
      );
    }
  }

  // 编辑类：diff 行数
  if (
    toolName === "edit_file" ||
    toolName === "write_file" ||
    toolName === "str_replace"
  ) {
    return (
      <div className="font-mono text-[10.5px] text-success/80">
        ✓ 已更新文件
      </div>
    );
  }

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

/* ---------------------------------------------------------------- */
/* 展开态：tool-specific output 渲染                                  */
/* ---------------------------------------------------------------- */

function ResultRenderer({ result, tool }: { result: any; tool: ToolCallPart }) {
  const name = tool.toolName;

  // shell：stdout + stderr + exit_code 分块展示
  if (name === "execute_command" || name === "shell") {
    return <ShellResultRenderer result={result} />;
  }

  // 编辑：把结果当成"成功/失败"提示，不重复展示 diff
  if (name === "edit_file" || name === "str_replace") {
    return (
      <div className="font-mono text-[11px] text-foreground/90">
        {typeof result === "string" ? result : "✓ 文件已更新"}
      </div>
    );
  }

  // 写文件：成功提示
  if (name === "write_file") {
    const path = tool.args?.file_path ?? tool.args?.path;
    return (
      <div className="space-y-1.5 font-mono text-[11px] text-foreground/90">
        <div className="text-success/80">✓ 已写入文件</div>
        {path && (
          <div className="text-muted-foreground/80">{path}</div>
        )}
        {typeof result === "string" && result.trim() && (
          <div className="text-muted-foreground/80">{result}</div>
        )}
      </div>
    );
  }

  // 读文件：内容作为代码块
  if (name === "read_file") {
    const path = tool.args?.file_path ?? tool.args?.path;
    const lang = path ? inferLang(path) : "text";
    const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    return (
      <CodeBlock language={lang} value={truncateText(text, 20000)} className="my-0" />
    );
  }

  // 列表 / 通用
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
      name === "web_search" &&
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
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void openExternalUrl(r.url);
              }}
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

function ShellResultRenderer({ result }: { result: any }) {
  // shell result 形态各异：
  // - { stdout, stderr, exit_code }
  // - { output, exitCode }
  // - 纯字符串
  // - { content: [...] }
  if (typeof result === "string") {
    return (
      <CodeBlock language="bash" value={truncateText(result, 20000)} className="my-0" />
    );
  }

  if (result && typeof result === "object" && !Array.isArray(result)) {
    const stdout =
      result.stdout ?? result.output ?? result.content ?? "";
    const stderr = result.stderr ?? "";
    const exit = result.exit_code ?? result.exitCode ?? result.code;
    const truncated =
      (typeof stdout === "string" ? stdout.length : 0) > 20000 ||
      (typeof stderr === "string" ? stderr.length : 0) > 20000;

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 font-mono text-[10.5px]">
          <span className="text-muted-foreground/70">exit</span>
          <span
            className={
              exit === 0 || exit === undefined
                ? "text-success/80"
                : "text-destructive/80"
            }
          >
            {exit ?? 0}
          </span>
          {truncated && (
            <span className="text-muted-foreground/60">· 已截断</span>
          )}
        </div>
        {typeof stdout === "string" && stdout.length > 0 && (
          <CodeBlock
            language="bash"
            value={truncateText(stdout, 20000)}
            className="my-0"
          />
        )}
        {typeof stderr === "string" && stderr.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-destructive/80">
              <XCircle className="h-2.5 w-2.5" />
              stderr
            </div>
            <CodeBlock
              language="bash"
              value={truncateText(stderr, 20000)}
              className="my-0"
            />
          </div>
        )}
        {typeof stdout !== "string" && (
          <CodeBlock
            language="json"
            value={JSON.stringify(result, null, 2)}
            className="my-0"
          />
        )}
      </div>
    );
  }

  if (Array.isArray(result)) {
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
