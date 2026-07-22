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
  // 字符串形式：args.command / args.cmd / args.shell_command / args.script
  const stringish = args.command ?? args.cmd ?? args.shell_command ?? args.script;
  if (typeof stringish === "string") return stringish;
  if (Array.isArray(stringish)) return stringish.join(" ");
  // 数组形式（run_command 等 CLI 风格工具常用）：
  //   { args: ["ls", "-la"] } / { argv: [...] } / 直接 args 是数组
  const arrayish = args.args ?? args.argv ?? args.command_args;
  if (Array.isArray(arrayish)) return arrayish.join(" ");
  // 万一 args 本身是个数组（少数工具签名）
  if (Array.isArray(args)) return args.join(" ");
  return undefined;
}

/**
 * shell 命令的"cwd"环境。识别常见字段名；找到才返回。
 * 用于在 header 里附加 "in /path" 这类上下文，避免展开才能看到。
 */
export function pickCwd(args: any): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const v = args.cwd ?? args.workdir ?? args.working_dir ?? args.directory;
  return typeof v === "string" ? v : undefined;
}

/**
 * AGNO 工具的结果常常被包一层外层对象 —— 实际"用户可见的数据"在内层 key 里：
 *   - web_search / web_fetch → `{ results: [{url, title, excerpt}, ...], search_id, ... }`
 *   - list_files            → `{ files: [{path, type, size}, ...], directory, ... }`
 *   - query_my_codebase     → 有时 `{ files: [...] }`（带额外元数据）
 *   - 一些自定义工具        → `{ data: [...] }` / `{ items: [...] }` / `{ output: [...] }`
 *
 * 这次实拍 AGNO web_search 的 ToolCallCompleted 事件，`data.tool.result` 是
 * `'{"results":[...],"search_id":"..."}'`，前端 parse 后得到的是这个 wrapper；
 * 之前 `GenericResultRenderer` 只检查 `Array.isArray(result)` —— 命中 false，
 * 直接走 JSON 兜底，**用户看不到一条搜索结果，只看到一大坨 JSON**。
 *
 * 这个函数尝试把这些常用 wrapper key 拆开，返回"看起来像数据"的那一项。
 * 找不到就原样返回 payload，调用方决定下一步（一般是 JSON dump）。
 *
 * 注意：**只对对象**操作。string / array / null 不动，传出去给调用方处理。
 */
export interface UnwrapResult {
  payload: any;
  /** 命中的 wrapper key（用于诊断 / 调试） */
  wrapperKey?: string;
  /** 是否被 unwrap 了（false 表示原样透传） */
  unwrapped: boolean;
}

export function unwrapToolResult(result: any): UnwrapResult {
  if (result === null || result === undefined) return { payload: result, unwrapped: false };
  if (typeof result !== "object" || Array.isArray(result)) {
    return { payload: result, unwrapped: false };
  }
  // 按常见度从高到低尝试 wrapper key。
  // 顺序：web_search / web_fetch 用 results；list_files / search_knowledge 用 files；
  // 后面是通用兜底。
  const candidates = [
    "results",
    "files",
    "items",
    "data",
    "output",
    "content",
  ];
  for (const k of candidates) {
    const v = (result as any)[k];
    // 只对"非空数组"做 unwrap —— 避免把单字段对象误判为 wrapper。
    if (Array.isArray(v) && v.length > 0) {
      return { payload: v, wrapperKey: k, unwrapped: true };
    }
  }
  return { payload: result, unwrapped: false };
}

/**
 * 把 tool.result 字符串化版本（实际 AGNO 上行是 JSON string）parse 回对象。
 * 不是 string 时原样返回。
 */
export function parseToolResultStringified(result: any): any {
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

/**
 * shell 工具识别 —— 跟 ToolCallCard 内的 SHELL_TOOLS 同步。
 * 抽出独立函数让 formatToolCallForCopy / ShellResultRenderer 都能复用。
 */
const SHELL_TOOL_NAMES = new Set([
  "execute_command",
  "run_command",
  "shell",
  "bash",
]);

export function isShellTool(toolName: string): boolean {
  return SHELL_TOOL_NAMES.has(toolName);
}

/**
 * 从各种形态的 shell 结果里抽出 `{ stdout, stderr, exit }`。
 *
 * AGNO / 各种 shell 工具 wrapper 返回的 result 字段五花八门：
 *   - 纯字符串
 *   - { stdout, stderr, exit_code }
 *   - { output, exitCode }         ← 旧版 / 部分 wrapper
 *   - { result, exit_code }        ← 某些 AGNO 版本直接包了一层
 *   - { content: "..." | [{type, text}] }   ← 字符串或 Anthropic-style 数组
 *   - [{type: "text", text: "..."}, ...]    ← 顶层就是 content 数组
 *
 * 这里把所有常见 key 都试一遍。找不到任何可识别字段时，三个字段都返回
 * undefined —— 调用方决定怎么兜底（通常是 JSON 化展示）。
 */
export interface ShellOutput {
  stdout?: string;
  stderr?: string;
  exit?: number;
}

export function pickShellOutput(result: any): ShellOutput {
  if (result === null || result === undefined) return {};
  if (typeof result === "string") return { stdout: result };

  if (Array.isArray(result)) {
    // Anthropic-style content 数组：[{type: "text", text: "..."}]
    if (
      result.length > 0 &&
      result.every(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof (item as any).text === "string"
      )
    ) {
      return { stdout: result.map((item: any) => item.text).join("\n") };
    }
    // 普通字符串数组：line 列表
    if (result.every((item) => typeof item === "string")) {
      return { stdout: result.join("\n") };
    }
    return {};
  }

  if (typeof result !== "object") return { stdout: String(result) };

  const out: ShellOutput = {};

  // stdout：按常见度从高到低。覆盖 shell wrapper、AGNO 直包、Anthropic-style 嵌套
  const stdoutCandidate =
    result.stdout ??
    result.output ??
    result.content ??
    result.result ??
    result.output_text ??
    result.outputText ??
    result.text ??
    result.data ??
    result.body ??
    result.response ??
    result.response_text ??
    result.return_value ??
    result.message;

  out.stdout = extractString(stdoutCandidate);

  // stderr：通常就叫 stderr / err
  out.stderr = extractString(result.stderr ?? result.err);

  // exit code
  const exitCandidate =
    result.exit_code ?? result.exitCode ?? result.code ?? result.returncode;
  if (typeof exitCandidate === "number") out.exit = exitCandidate;

  return out;
}

/**
 * 把任意候选值规整为字符串（处理 string / Anthropic-style 数组 / 含 text 字段的
 * 对象）；不能规整时返回 undefined。
 */
function extractString(v: any): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    if (v.length === 0) return undefined;
    if (
      v.every(
        (item) => item && typeof item === "object" && typeof (item as any).text === "string"
      )
    ) {
      return v.map((item: any) => item.text).join("\n");
    }
    if (v.every((item) => typeof item === "string")) return v.join("\n");
    return undefined;
  }
  if (typeof v === "object") {
    if (typeof v.text === "string") return v.text;
    return undefined;
  }
  // number / boolean —— 至少能看到值
  return String(v);
}

/**
 * 一组 read-like 工具名。当 agent 连续调用这些时折叠成一张卡片，
 * 节省 vertical space —— "agent 读了 3 个文件" 不需要 3 张卡片。
 *
 * 判定标准："读 / 列出 / 检索"语义的工具，不修改外部状态。
 * - read_file / list_directory：文件系统
 * - query_my_codebase / search_knowledge：代码 / 知识库检索
 *
 * 排除：web_search / web_fetch（虽然也是"读"，但通常每次都返回重要结构化结果，
 * 折叠反而损失信息；web 结果本身有卡片化的渲染）。
 */
const READ_LIKE_TOOLS = new Set([
  "read_file",
  "list_directory",
  "query_my_codebase",
  "search_knowledge",
]);

export function isReadLikeTool(toolName: string): boolean {
  return READ_LIKE_TOOLS.has(toolName);
}

/**
 * 从工具 args 中抽出一个用于显示的"标识" —— 文件路径优先。
 * 用于分组卡片里列出每条 call 的简短摘要。
 */
export function pickToolIdentifier(
  toolName: string,
  args: any
): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  if (
    toolName === "read_file" ||
    toolName === "list_directory"
  ) {
    const p = args.file_path ?? args.path ?? args.directory;
    if (typeof p === "string") return p;
  }
  if (toolName === "query_my_codebase") {
    const q = args.query ?? args.question ?? args.q;
    if (typeof q === "string") return q;
  }
  if (toolName === "search_knowledge") {
    const q = args.query ?? args.q;
    if (typeof q === "string") return q;
  }
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
 *
 * 始终包含三段：**Input** / **Output** /（如有）**Error** —— 即使 output
 * 为空也保留 "Output: (no output)" 的明确占位，方便区分"工具没返回"和
 * "工具调用还在跑"。
 *
 * Shell 工具的 result 形态多样（`{stdout, stderr, exit_code}` /
 * `{output, exitCode}` / `{result, exit_code}` / 纯字符串），经
 * `pickShellOutput` 归一化后用 plain text 块输出，而不是包成 JSON 整体
 * —— 后者会把 stdout / exit_code 等结构信息压平到一行 JSON 里，不利于
 * 直接贴 issue / 文档。
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

  lines.push("**Output:**");
  lines.push(...formatOutputForCopy(tool));
  lines.push("");

  if (tool.durationMs != null) {
    lines.push(
      `_duration: ${tool.durationMs < 1000 ? `${tool.durationMs}ms` : `${(tool.durationMs / 1000).toFixed(2)}s`}_`
    );
  }
  return lines.join("\n");
}

/**
 * 把 tool.result 格式化为多行 markdown 代码块序列。
 *
 * - shell 工具：stdout / stderr 各自一段 text block，再附加 exit code
 * - 字符串：单段 text block
 * - 其他对象：JSON 化
 * - 没有 result / 空字符串："(no output)"
 * - 还在跑："(running…)"
 *
 * 返回值是若干行字符串（不含 **Output:** 标题），调用方拼到自己的 lines 里。
 */
function formatOutputForCopy(tool: ToolCallPart): string[] {
  const lines: string[] = [];
  const result = tool.result;

  if (tool.status === "calling") {
    lines.push("_(running, no output yet)_");
    return lines;
  }

  // shell 工具走专用路径
  if (isShellTool(tool.toolName)) {
    if (result === undefined || result === null || result === "") {
      lines.push("_(no output)_");
      return lines;
    }
    const parsed = pickShellOutput(result);
    const stdout = parsed.stdout ?? "";
    const stderr = parsed.stderr ?? "";
    const exit = parsed.exit;

    if (stdout.length > 0) {
      lines.push("```");
      // 去掉尾随换行 —— shell 输出末尾通常自带 \n，避免渲染出空白行。
      lines.push(stdout.replace(/\n+$/, ""));
      lines.push("```");
    }
    if (stderr.length > 0) {
      lines.push("**stderr:**");
      lines.push("```");
      lines.push(stderr.replace(/\n+$/, ""));
      lines.push("```");
    }
    if (exit !== undefined) {
      lines.push(`exit: ${exit}`);
    }
    if (stdout.length === 0 && stderr.length === 0 && exit === undefined) {
      // pickShellOutput 没认出任何字段 —— 但 result 本身非空。
      // 把原文（text / JSON）兜底展示出来，避免"有返回但复制不到"。
      if (typeof result === "string") {
        lines.push("```");
        lines.push(result.replace(/\n+$/, ""));
        lines.push("```");
      } else {
        lines.push("```json");
        lines.push(JSON.stringify(result, null, 2));
        lines.push("```");
      }
    }
    return lines;
  }

  // 非 shell 工具 —— 跟 UI 渲染走同一条 unwrap 路径，避免 UI 看到列表但 copy 出来
  // 是 wrapper 对象的情况。
  if (result === undefined || result === null) {
    lines.push("_(no output)_");
    return lines;
  }

  // 如果 result 还是 JSON 字符串，二次 parse（防御 chat-runner 未 parse 的场景）
  const parsed = parseToolResultStringified(result);
  if (typeof parsed === "string") {
    if (parsed.length === 0) {
      lines.push("_(no output)_");
      return lines;
    }
    lines.push("```");
    lines.push(parsed);
    lines.push("```");
    return lines;
  }

  // 尝试解开 AGNO 常见 wrapper（web_search 的 `{results:[...]}` 等）
  const unwrapped = unwrapToolResult(parsed);
  const payload = unwrapped.payload;

  if (typeof payload === "string") {
    lines.push("```");
    lines.push(payload);
    lines.push("```");
    return lines;
  }
  if (Array.isArray(payload)) {
    // 让用户复制到的也是真正的数据列表，不是被 wrapper 包过的对象
    lines.push("```json");
    lines.push(JSON.stringify(payload, null, 2));
    lines.push("```");
    return lines;
  }
  if (typeof payload === "object" && payload !== null) {
    lines.push("```json");
    lines.push(JSON.stringify(payload, null, 2));
    lines.push("```");
    return lines;
  }
  lines.push("_(no output)_");
  return lines;
}
