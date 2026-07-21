/**
 * tool-render-utils — ToolCallCard 用到的纯函数 helper
 *
 * 单独抽出是为了让 diff / copy 格式化 / lang 推断 / shell 命令识别
 * 可以被 unit test 直接 import，避免渲染整个 React 树。
 *
 * 这些函数**没有**任何 React 依赖，也不会触碰 DOM/store，是纯计算。
 */

import type { ToolCallPart } from "@/lib/message-types";

export function pickCommand(args: any): string | undefined {
  if (!args) return undefined;
  const v = args.command ?? args.cmd ?? args.shell_command;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.join(" ");
  return undefined;
}

/**
 * 工具名 → 代码块语言映射。仅覆盖常见扩展名；不在表里就 fallback "text"。
 */
export function inferLang(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rb: "ruby",
    rs: "rust",
    go: "go",
    java: "java",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    html: "html",
    css: "css",
    scss: "scss",
    sql: "sql",
    toml: "ini",
    xml: "xml",
  };
  return langMap[ext] ?? "text";
}

export function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n\n... (truncated, total ${s.length} chars)`;
}

/**
 * 行级 LCS：返回 diff ops 序列（"=" / "-" / "+"）。
 * 输入规模小（典型的 file edit 内容 < 几百行），O(N*M) 完全够用。
 *
 * 大文件兜底：任一边超过 2000 行就退化为"全 del + 全 add"，
 * 避免 OOM / 卡 UI。
 */
export function computeLcs(
  a: string[],
  b: string[]
): Array<"=" | "-" | "+"> {
  const n = a.length;
  const m = b.length;
  const cap = 2000;
  if (n > cap || m > cap) {
    const ops: Array<"=" | "-" | "+"> = [];
    for (let i = 0; i < n; i++) ops.push("-");
    for (let j = 0; j < m; j++) ops.push("+");
    return ops;
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Array<"=" | "-" | "+"> = [];
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push("=");
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push("-");
      i++;
    } else {
      ops.push("+");
      j++;
    }
  }
  while (i < n) {
    ops.push("-");
    i++;
  }
  while (j < m) {
    ops.push("+");
    j++;
  }
  return ops;
}

/**
 * 整体拷贝格式 —— 把工具调用拼成可读的 markdown 文本。
 * 一次性带上：tool 名称、状态、input JSON、error、output、duration。
 *
 * 用户场景：跟同事分享一个工具调用的细节、写到 issue / 文档里。
 */
export function formatToolCallForCopy(tool: ToolCallPart): string {
  const lines: string[] = [];
  const status =
    tool.status === "calling"
      ? "running"
      : tool.status === "error"
      ? "error"
      : "completed";
  const displayName = tool.toolName
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
  lines.push(`### ${displayName} (${status})`);
  lines.push("");

  if (tool.args && Object.keys(tool.args).length > 0) {
    lines.push("**Input:**");
    lines.push("```json");
    lines.push(JSON.stringify(tool.args, null, 2));
    lines.push("```");
    lines.push("");
  }

  if (tool.error) {
    lines.push("**Error:**");
    lines.push("```");
    lines.push(tool.error);
    lines.push("```");
    lines.push("");
  }

  if (tool.result !== undefined && tool.result !== null) {
    lines.push("**Output:**");
    const r = tool.result;
    if (typeof r === "string") {
      lines.push("```");
      lines.push(r);
      lines.push("```");
    } else {
      lines.push("```json");
      lines.push(JSON.stringify(r, null, 2));
      lines.push("```");
    }
    lines.push("");
  }

  if (tool.durationMs != null) {
    lines.push(
      `_duration: ${tool.durationMs < 1000 ? `${tool.durationMs}ms` : `${(tool.durationMs / 1000).toFixed(2)}s`}_`
    );
  }
  return lines.join("\n");
}
