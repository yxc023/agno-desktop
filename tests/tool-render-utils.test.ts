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
  inferLang,
  computeLcs,
  formatToolCallForCopy,
  truncateText,
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
  console.log("=== pickCommand: 识别 shell 命令 ===");
  {
    eq(pickCommand({ command: "ls -la" }), "ls -la", "key=command");
    eq(pickCommand({ cmd: "echo hi" }), "echo hi", "key=cmd");
    eq(pickCommand({ shell_command: "pwd" }), "pwd", "key=shell_command");
    eq(
      pickCommand({ command: ["git", "log", "--oneline"] }),
      "git log --oneline",
      "数组形式用空格 join"
    );
    eq(pickCommand(undefined), undefined, "undefined args → undefined");
    eq(pickCommand({}), undefined, "空 args → undefined");
    eq(pickCommand({ cwd: "/tmp" }), undefined, "没有 command → undefined");
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
    assert(out.includes('"stdout":'), "output 是 JSON 形式");
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

  console.log(
    `\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
