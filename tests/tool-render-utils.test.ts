/**
 * tool-render-utils.test.ts
 *
 * 覆盖 ToolCallCard 抽出来的纯函数：
 * - pickCommand：识别 shell 命令字符串（兼容多种 key / 数组形式）
 * - inferLang：从文件路径推断语法高亮语言
 * - computeLcs：行级 LCS（diff 的基础）
 * - formatToolCallForCopy：整体拷贝格式
 * - truncateText：超长结果截断
 *
 * 这些都是 UI 行为的 single source of truth——错了用户能看到的就是错的，
 * 所以必须打覆盖。
 */
/* oxlint-disable */

import {
  pickCommand,
  pickCwd,
  pickShellOutput,
  isShellTool,
  inferLang,
  computeLcs,
  formatToolCallForCopy,
  truncateText,
  isReadLikeTool,
  pickToolIdentifier,
  unwrapToolResult,
  parseToolResultStringified,
} from "../src/lib/tool-render-utils";
import type { ToolCallPart } from "../src/lib/message-types";

// ─────────── assert framework（与项目其他 test 文件保持一致）───────────
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed++;
    console.error(`✗ ${msg}`);
  } else {
    console.log(`✓ ${msg}`);
  }
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  assert(
    actual === expected,
    `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function deepEq(actual: unknown, expected: unknown, msg: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function main(): void {
  console.log("=== pickCommand: 识别 shell 命令（字符串形式）===");
  {
    eq(pickCommand({ command: "ls -la" }), "ls -la", "key=command");
    eq(pickCommand({ cmd: "echo hi" }), "echo hi", "key=cmd");
    eq(pickCommand({ shell_command: "pwd" }), "pwd", "key=shell_command");
    eq(pickCommand({ script: "exit 0" }), "exit 0", "key=script");
    eq(
      pickCommand({ command: ["git", "log", "--oneline"] }),
      "git log --oneline",
      "command 数组形式用空格 join"
    );
    eq(pickCommand(undefined), undefined, "undefined args → undefined");
    eq(pickCommand({}), undefined, "空 args → undefined");
    eq(pickCommand({ cwd: "/tmp" }), undefined, "没有 command → undefined");
  }

  console.log("\n=== pickCommand: run_command 风格的 args 数组形式 ===");
  {
    eq(
      pickCommand({ args: ["ls", "-la", "/tmp"] }),
      "ls -la /tmp",
      "key=args（数组）"
    );
    eq(
      pickCommand({ argv: ["echo", "hi"] }),
      "echo hi",
      "key=argv"
    );
    eq(
      pickCommand({ command_args: ["npm", "install"] }),
      "npm install",
      "key=command_args"
    );
    eq(
      pickCommand(["python", "-c", "print(1)"]),
      "python -c print(1)",
      "args 本身是数组（罕见签名）"
    );
  }

  console.log("\n=== pickCommand: 命令优先于 args 数组 ===");
  {
    eq(
      pickCommand({ command: "echo main", args: ["ignored"] }),
      "echo main",
      "command 字段优先"
    );
    eq(
      pickCommand({ cmd: ["a", "b"], args: ["c", "d"] }),
      "a b",
      "cmd 数组优先于 args 数组"
    );
  }

  console.log("\n=== pickCwd: 识别工作目录 ===");
  {
    eq(pickCwd({ cwd: "/tmp" }), "/tmp", "key=cwd");
    eq(pickCwd({ workdir: "/var" }), "/var", "key=workdir");
    eq(pickCwd({ working_dir: "/home" }), "/home", "key=working_dir");
    eq(pickCwd({ directory: "/root" }), "/root", "key=directory");
    eq(pickCwd(undefined), undefined, "undefined → undefined");
    eq(pickCwd({ cwd: 123 }), undefined, "非字符串 → undefined");
  }

  console.log("\n=== isReadLikeTool: read-like 判定 ===");
  {
    assert(isReadLikeTool("read_file"), "read_file 是 read-like");
    assert(isReadLikeTool("list_directory"), "list_directory 是 read-like");
    assert(
      isReadLikeTool("query_my_codebase"),
      "query_my_codebase 是 read-like"
    );
    assert(
      isReadLikeTool("search_knowledge"),
      "search_knowledge 是 read-like"
    );
    assert(!isReadLikeTool("write_file"), "write_file 不是 read-like");
    assert(!isReadLikeTool("edit_file"), "edit_file 不是 read-like");
    assert(!isReadLikeTool("execute_command"), "execute_command 不是 read-like");
    assert(!isReadLikeTool("web_search"), "web_search 不是 read-like（折叠会损失结构）");
    assert(!isReadLikeTool("unknown_tool"), "未知工具默认 false");
  }

  console.log("\n=== pickToolIdentifier: read-like 工具的标识 ===");
  {
    eq(
      pickToolIdentifier("read_file", { file_path: "/a/b.ts" }),
      "/a/b.ts",
      "read_file → file_path"
    );
    eq(
      pickToolIdentifier("list_directory", { directory: "/src" }),
      "/src",
      "list_directory → directory"
    );
    eq(
      pickToolIdentifier("query_my_codebase", { question: "what is X" }),
      "what is X",
      "query_my_codebase → question"
    );
    eq(
      pickToolIdentifier("search_knowledge", { query: "AGNO" }),
      "AGNO",
      "search_knowledge → query"
    );
    eq(
      pickToolIdentifier("read_file", { foo: "bar" }),
      undefined,
      "没有识别字段 → undefined"
    );
  }

  console.log("\n=== inferLang: 文件路径 → 高亮语言 ===");
  {
    eq(inferLang("foo.ts"), "typescript", ".ts");
    eq(inferLang("foo.TSX"), "tsx", "大写扩展名也识别");
    eq(inferLang("/abs/path/bar.py"), "python", ".py");
    eq(inferLang("README.md"), "markdown", ".md");
    eq(inferLang("script.sh"), "bash", ".sh");
    eq(inferLang("a/b/c.json"), "json", ".json");
    eq(inferLang("noext"), "text", "无扩展名 → text");
    eq(inferLang("foo.unknown"), "text", "未知扩展名 → text");
  }

  console.log("\n=== computeLcs: 行级 LCS ===");
  {
    deepEq(
      computeLcs(["a", "b", "c"], ["a", "b", "c"]),
      ["=", "=", "="],
      "完全相同：全等号"
    );
    deepEq(
      computeLcs(["a", "b", "c"], ["a", "x", "c"]),
      ["=", "-", "+", "="],
      "中间替换：del + add"
    );
    deepEq(
      computeLcs([], []),
      [],
      "两侧都为空"
    );
    deepEq(
      computeLcs(["a"], []),
      ["-"],
      "右侧为空：全 del"
    );
    deepEq(
      computeLcs([], ["a"]),
      ["+"],
      "左侧为空：全 add"
    );
    deepEq(
      computeLcs(["x", "y", "z"], ["a", "b", "c"]),
      ["-", "-", "-", "+", "+", "+"],
      "完全替换"
    );
    // 真实场景：编辑一行
    deepEq(
      computeLcs(
        ["const a = 1;", "const b = 2;", "console.log(a, b);"],
        ["const a = 1;", "const b = 99;", "console.log(a, b);"]
      ),
      ["=", "-", "+", "="],
      "改一行：保留上下文，中间替换"
    );
  }

  console.log("\n=== computeLcs: 大文件兜底 ===");
  {
    const big = new Array(3000).fill("line");
    const small = ["line", "new"];
    const ops = computeLcs(big, small);
    assert(ops.length > 0, "超大输入不抛错，返回降级 ops");
    // 降级策略：全 del + 全 add
    assert(
      ops[0] === "-" && ops.includes("+"),
      "超大输入降级为全 del + 全 add"
    );
  }

  console.log("\n=== formatToolCallForCopy: 整体拷贝 ===");
  {
    const tool: ToolCallPart = {
      type: "tool_call",
      toolCallId: "tc-1",
      toolName: "execute_command",
      args: { command: "ls -la", cwd: "/tmp" },
      result: { stdout: "file1\nfile2\n", exit_code: 0 },
      status: "completed",
      startedAt: 0,
      durationMs: 234,
    };
    const out = formatToolCallForCopy(tool);
    assert(out.startsWith("### Execute Command"), "以 display name 开头");
    assert(out.includes("(completed)"), "包含状态");
    assert(out.includes("**Input:**"), "包含 Input 段");
    assert(out.includes('"command": "ls -la"'), "input 含 command");
    assert(out.includes("**Output:**"), "包含 Output 段");
    // shell 工具的 stdout 现在以纯文本块输出（不再是 JSON 整体），
    // 用户粘贴到 issue / 文档里直接可读。
    assert(
      out.includes("```\nfile1\nfile2\n```"),
      "shell stdout 输出为 plain text 块"
    );
    assert(out.includes("exit: 0"), "exit code 单飞显示");
    assert(out.includes("_duration: 234ms_"), "duration 标注");
  }

  {
    const tool: ToolCallPart = {
      type: "tool_call",
      toolCallId: "tc-2",
      toolName: "web_search",
      args: { query: "AGNO news" },
      result: [{ title: "AGNO 0.0.7", url: "https://x" }],
      status: "completed",
      startedAt: 0,
      durationMs: 1200,
    };
    const out = formatToolCallForCopy(tool);
    assert(out.includes("### Web Search"), "snake_case → Title Case");
    assert(out.includes("_duration: 1.20s_"), "duration > 1s 走 s 单位");
  }

  {
    const tool: ToolCallPart = {
      type: "tool_call",
      toolCallId: "tc-3",
      toolName: "broken_tool",
      args: {},
      error: "connection refused",
      status: "error",
      startedAt: 0,
      durationMs: 5000,
    };
    const out = formatToolCallForCopy(tool);
    assert(out.includes("(error)"), "error 状态正确显示");
    assert(out.includes("**Error:**"), "有 Error 段");
    assert(out.includes("connection refused"), "error 文案保留");
  }

  {
    // 字符串 result
    const tool: ToolCallPart = {
      type: "tool_call",
      toolCallId: "tc-4",
      toolName: "read_file",
      args: { file_path: "/etc/hosts" },
      result: "127.0.0.1 localhost",
      status: "completed",
      startedAt: 0,
    };
    const out = formatToolCallForCopy(tool);
    assert(out.includes("**Output:**"), "有 Output 段");
    assert(out.includes("127.0.0.1 localhost"), "字符串 result 不被 JSON 化");
    assert(
      !out.includes("**Error:**"),
      "无 error 时不输出 Error 段"
    );
  }

  {
    // calling 状态
    const tool: ToolCallPart = {
      type: "tool_call",
      toolCallId: "tc-5",
      toolName: "write_file",
      args: { file_path: "/tmp/a", content: "x" },
      status: "calling",
      startedAt: 0,
    };
    const out = formatToolCallForCopy(tool);
    assert(out.includes("(running)"), "calling → running");
  }

  console.log("\n=== truncateText: 超长截断 ===");
  {
    eq(
      truncateText("hello", 100),
      "hello",
      "短于 max 不动"
    );
    const out = truncateText("a".repeat(200), 50);
    assert(out.length > 50, "长于 max 截断");
    assert(out.includes("... (truncated, total 200 chars)"), "标注总长");
  }

  console.log("\n=== unwrapToolResult: 拆 AGNO 常见 wrapper ===");
  {
    // 字面量类型透传
    assert(!unwrapToolResult(null).unwrapped, "null 透传");
    assert(!unwrapToolResult(undefined).unwrapped, "undefined 透传");
    assert(!unwrapToolResult("plain").unwrapped, "string 透传");
    assert(!unwrapToolResult([1, 2]).unwrapped, "array 透传");

    // web_search / web_fetch 风格：{results: [...]}
    deepEq(
      unwrapToolResult({
        search_id: "x",
        results: [{ url: "u1", title: "T1" }],
      }),
      {
        payload: [{ url: "u1", title: "T1" }],
        wrapperKey: "results",
        unwrapped: true,
      },
      "{search_id, results: [...]}"
    );

    // list_files 风格：{files: [...]}
    deepEq(
      unwrapToolResult({
        directory: "/x",
        files: [{ path: "a.ts" }, { path: "b.ts" }],
      }),
      {
        payload: [{ path: "a.ts" }, { path: "b.ts" }],
        wrapperKey: "files",
        unwrapped: true,
      },
      "{directory, files: [...]}"
    );

    // query_my_codebase / 通用 tool：{ data: [...] } 兜底
    deepEq(
      unwrapToolResult({
        meta: "x",
        data: [{ id: 1 }, { id: 2 }],
      }),
      {
        payload: [{ id: 1 }, { id: 2 }],
        wrapperKey: "data",
        unwrapped: true,
      },
      "{meta, data: [...]}"
    );

    // 不识别的对象：原样透传
    deepEq(
      unwrapToolResult({ stdout: "x", stderr: "y", exit_code: 0 }),
      {
        payload: { stdout: "x", stderr: "y", exit_code: 0 },
        unwrapped: false,
      },
      "shell style {stdout, stderr, exit_code} 不动（交给 pickShellOutput）"
    );

    // 空数组：不当作 wrapper（原样透传）
    deepEq(
      unwrapToolResult({ results: [], other: "x" }),
      { payload: { results: [], other: "x" }, unwrapped: false },
      "空 results 数组不展开"
    );
  }

  console.log("\n=== parseToolResultStringified: 二次 JSON parse ===");
  {
    // AGNO 上行 tc.result 已经是 string（前端 chat-runner 已 parse 一次），
    // 但有时（比如 history 加载路径）可能拿到没 parse 的 string —— 防御性再 parse。
    deepEq(
      parseToolResultStringified('{"a":1}'),
      { a: 1 },
      "JSON 字符串 → object"
    );
    deepEq(
      parseToolResultStringified("[1,2,3]"),
      [1, 2, 3],
      "JSON 字符串 → array"
    );
    eq(parseToolResultStringified("plain text"), "plain text", "非 JSON 字符串原样");
    eq(parseToolResultStringified(""), "", "空字符串原样");
    deepEq(
      parseToolResultStringified({ already: "object" }),
      { already: "object" },
      "非字符串直接返回"
    );
    deepEq(
      parseToolResultStringified(null),
      null,
      "null 原样"
    );
  }

  console.log("\n=== formatToolCallForCopy: web_search wrapper 也能解开 ===");
  {
    // 模拟 AGNO 实际返回的形态：tool.result 是对象 `{results: [...]}`，
    // formatToolCallForCopy 应当解开 wrapper 复制到真正的列表内容，
    // 而不是把 wrapper 整体 JSON 化（跟 UI 渲染一致）。
    const realAGNOShape = {
      search_id: "search_x",
      results: [
        { url: "https://a.example", title: "A" },
        { url: "https://b.example", title: "B" },
      ],
      warnings: null,
      usage: [{ name: "sku_search", count: 1 }],
    };
    const out = formatToolCallForCopy({
      type: "tool_call",
      toolCallId: "ws1",
      toolName: "web_search",
      args: { objective: "test" },
      result: realAGNOShape,
      status: "completed",
      startedAt: 0,
    } as any);
    // 应该看到解开的列表，不是 wrapper 对象
    assert(
      out.includes('"url": "https://a.example"'),
      "Output 段包含第一条结果的 url"
    );
    assert(out.includes('"title": "B"'), "Output 段包含第二条结果的 title");
    assert(
      !out.includes('"search_id": "search_x"'),
      "Output 段不再包含 wrapper 元数据 search_id"
    );
    assert(
      !out.includes('"warnings":'),
      "Output 段不再包含 wrapper 元数据 warnings"
    );
  }

  console.log("\n=== isShellTool: 工具名识别 ===");
  {
    assert(isShellTool("run_command"), "run_command");
    assert(isShellTool("execute_command"), "execute_command");
    assert(isShellTool("shell"), "shell");
    assert(isShellTool("bash"), "bash");
    assert(!isShellTool("read_file"), "read_file 不是 shell");
    assert(!isShellTool("web_search"), "web_search 不是 shell");
    assert(!isShellTool("unknown"), "未知不是 shell");
  }

  console.log("\n=== pickShellOutput: AGNO 各种 result 形态 ===");
  {
    deepEq(
      pickShellOutput({ stdout: "x", exit_code: 0 }),
      { stdout: "x", exit: 0 },
      "{stdout, exit_code}"
    );
    deepEq(
      pickShellOutput({ output: "y", exitCode: 1 }),
      { stdout: "y", exit: 1 },
      "{output, exitCode}（legacy）"
    );
    deepEq(
      pickShellOutput({ result: "/home/user", exit_code: 0 }),
      { stdout: "/home/user", exit: 0 },
      "{result, exit_code}（AGNO 某些版本直接包一层）"
    );
    deepEq(
      pickShellOutput({ stdout: "out", stderr: "err", exit_code: 2 }),
      { stdout: "out", stderr: "err", exit: 2 },
      "{stdout, stderr, exit_code} 三段都有"
    );
    deepEq(
      pickShellOutput("raw string"),
      { stdout: "raw string" },
      "纯字符串 → stdout"
    );
    deepEq(
      pickShellOutput(["line1", "line2"]),
      { stdout: "line1\nline2" },
      "数组 → stdout（用 \\n join）"
    );
    deepEq(
      pickShellOutput({ stdout: ["a", "b"] }),
      { stdout: "a\nb" },
      "stdout 字段是数组也 join"
    );
    deepEq(pickShellOutput(null), {}, "null → empty");
    deepEq(pickShellOutput(undefined), {}, "undefined → empty");
    deepEq(
      pickShellOutput({}),
      {},
      "空对象 → empty"
    );

    // 不识别字段：pickShellOutput 全部 undefined，调用方决定怎么 fallback
    deepEq(
      pickShellOutput({ foo: "bar", baz: 42 }),
      {},
      "非标准字段 → empty（不强行猜）"
    );
  }

  console.log("\n=== pickShellOutput: 追加覆盖更多 AGNO 形态 ===");
  {
    deepEq(
      pickShellOutput({ outputText: "y" }),
      { stdout: "y" },
      "{outputText}（驼峰命名）"
    );
    deepEq(
      pickShellOutput({ response: "z" }),
      { stdout: "z" },
      "{response}"
    );
    deepEq(
      pickShellOutput({ response_text: "hello", exit_code: 0 }),
      { stdout: "hello", exit: 0 },
      "{response_text, exit_code}"
    );
    deepEq(
      pickShellOutput({ return_value: "rv" }),
      { stdout: "rv" },
      "{return_value}"
    );
    deepEq(
      pickShellOutput({ message: "msg" }),
      { stdout: "msg" },
      "{message}"
    );

    // Anthropic-style content array (顶层)
    deepEq(
      pickShellOutput([{ type: "text", text: "first" }]),
      { stdout: "first" },
      "顶层 Anthropic-style content array（单元素）"
    );
    deepEq(
      pickShellOutput([
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ]),
      { stdout: "first\nsecond" },
      "顶层 Anthropic-style content array（多元素用 \\n join）"
    );

    // 嵌套在 content 字段里的 Anthropic-style array
    deepEq(
      pickShellOutput({
        content: [{ type: "text", text: "nested" }],
        exit_code: 0,
      }),
      { stdout: "nested", exit: 0 },
      "嵌套 Anthropic-style content array"
    );

    // 旧 bug 修复回归：[object Object] 不再出现
    deepEq(
      pickShellOutput([{ type: "text", text: "anthropic" }]),
      { stdout: "anthropic" },
      "Anthropic 数组不再渲染成 '[object Object]'"
    );
  }

  console.log("\n=== formatToolCallForCopy: shell 工具 result 形态全覆盖 ===");
  {
    // 工具函数：从 Output 段之后到 EOF / Duration 之间的文本，用来精确断言。
    function outputSection(out: string): string {
      const i = out.indexOf("**Output:**");
      if (i < 0) return "";
      const rest = out.slice(i);
      const durIdx = rest.indexOf("_duration:");
      return durIdx < 0 ? rest : rest.slice(0, durIdx);
    }

    // 1. 字符串 result
    {
      const out = formatToolCallForCopy({
        type: "tool_call",
        toolCallId: "s1",
        toolName: "run_command",
        args: { args: ["echo", "hi"] },
        result: "hi\n",
        status: "completed",
        startedAt: 0,
      } as any);
      const o = outputSection(out);
      assert(o.includes("```\nhi\n```"), "字符串 result 输出为 plain text");
      assert(
        !o.includes("```json"),
        "Output 段没有 JSON 包裹（args 段有 JSON 没事）"
      );
    }

    // 2. {stdout, exit_code}
    {
      const out = formatToolCallForCopy({
        type: "tool_call",
        toolCallId: "s2",
        toolName: "execute_command",
        args: { command: "ls" },
        result: { stdout: "a\nb", exit_code: 0 },
        status: "completed",
        startedAt: 0,
      } as any);
      const o = outputSection(out);
      assert(o.includes("```\na\nb\n```"), "stdout 干净输出");
      assert(o.includes("exit: 0"), "exit 单飞");
    }

    // 3. {result, exit_code} —— 这是用户遇到 bug 的格式
    {
      const out = formatToolCallForCopy({
        type: "tool_call",
        toolCallId: "s3",
        toolName: "run_command",
        args: { args: ["pwd"] },
        result: { result: "/home/user", exit_code: 0 },
        status: "completed",
        startedAt: 0,
      } as any);
      const o = outputSection(out);
      assert(
        o.includes("```\n/home/user\n```"),
        "{result, exit_code} → stdout 内容直接出现"
      );
      assert(
        !o.includes('"result": "/home/user"'),
        "不再是裸 JSON（之前的 bug）"
      );
      assert(o.includes("exit: 0"), "exit code 仍然在");
    }

    // 4. 空 stdout + exit 0：仅显示 exit（用户能看出"跑成功但没输出"）
    {
      const out = formatToolCallForCopy({
        type: "tool_call",
        toolCallId: "s4",
        toolName: "run_command",
        args: { args: ["true"] },
        result: { stdout: "", exit_code: 0 },
        status: "completed",
        startedAt: 0,
      } as any);
      const o = outputSection(out);
      assert(o.includes("exit: 0"), "空 stdout 仍有 exit 提示");
      assert(!o.includes("```json"), "Output 段没有 JSON 包裹");
    }

    // 5. 完全没 result（AGNO 异常 / 流中断）
    {
      const out = formatToolCallForCopy({
        type: "tool_call",
        toolCallId: "s5",
        toolName: "run_command",
        args: { args: ["sleep", "10"] },
        status: "completed",
        startedAt: 0,
      } as any);
      assert(out.includes("_(no output)_"), "无 result → 显式占位");
    }

    // 6. 还在跑
    {
      const out = formatToolCallForCopy({
        type: "tool_call",
        toolCallId: "s6",
        toolName: "run_command",
        args: { args: ["sleep", "10"] },
        status: "calling",
        startedAt: 0,
      } as any);
      assert(
        out.includes("_(running, no output yet)_"),
        "calling 状态显示 running 占位"
      );
    }

    // 7. stderr 分段
    {
      const out = formatToolCallForCopy({
        type: "tool_call",
        toolCallId: "s7",
        toolName: "run_command",
        args: { args: ["false"] },
        result: { stdout: "", stderr: "boom!", exit_code: 1 },
        status: "completed",
        startedAt: 0,
      } as any);
      const o = outputSection(out);
      assert(o.includes("**stderr:**"), "stderr 分段标题");
      assert(o.includes("```\nboom!\n```"), "stderr 文本");
      assert(o.includes("exit: 1"), "非 0 exit code");
    }

    // 8. 任何情况下都包含 Output 段（用户要求"总能复制到输出"）
    {
      const out = formatToolCallForCopy({
        type: "tool_call",
        toolCallId: "s8",
        toolName: "read_file",
        args: { file_path: "/x" },
        status: "completed",
        startedAt: 0,
      } as any);
      assert(out.includes("**Output:**"), "非 shell 工具也始终有 Output 段");
      assert(out.includes("_(no output)_"), "无 result → 占位");
    }
  }

  console.log("\n=== formatToolCallForCopy: name / input / output 始终齐全 ===");
  {
    // 最小 case：有 args（保证 Input 段出现）+ name + 必然的 Output 段
    const out = formatToolCallForCopy({
      type: "tool_call",
      toolCallId: "min",
      toolName: "ping",
      args: { url: "https://example.com" },
      status: "completed",
      startedAt: 0,
    } as any);
    assert(out.startsWith("### Ping"), "name 在第一行");
    assert(out.includes("**Input:**"), "input 段");
    assert(out.includes("**Output:**"), "output 段");
    // 三段都有，顺序：name → input → output
    const nameIdx = out.indexOf("### Ping");
    const inputIdx = out.indexOf("**Input:**");
    const outputIdx = out.indexOf("**Output:**");
    assert(
      nameIdx < inputIdx && inputIdx < outputIdx,
      "name / input / output 顺序正确"
    );
  }

  console.log(
    `\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
