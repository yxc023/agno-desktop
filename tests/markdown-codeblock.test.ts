/**
 * Markdown code block rendering — regression tests for the
 * "[object Object]" bug + worker-based highlighting contract.
 *
 * Bug history:
 *   - `Markdown.tsx` 的 `code` 组件用 `String(children ?? "")` 把 react-markdown
 *     经 rehype-highlight 处理后的子树序列化成文本。
 *   - 但 `children` 在 fenced code block 路径下是 React element 数组（hljs token
 *     spans），`String([span, span])` 会返回 `"[object Object],[object Object],..."`。
 *   - 用户看到代码块里出现一串 "[object Object]" 字样，无法正确显示内容。
 *
 * 修复：
 *   - `Markdown.tsx` 的 `code` 把 children 拍平成 string 传给 `CodeBlock`。
 *   - inline vs block 改用 className 里的 `language-*` 区分。
 *   - `CodeBlock` 通过 Web Worker 异步高亮（见 `useHighlight`），静态 markup
 *     阶段还没拿到 worker 响应，所以渲染 plain text；highlight 到了之后
 *     通过 `dangerouslySetInnerHTML` 替换。
 *
 * Usage:
 *   bun run tests/markdown-codeblock.test.ts
 */
/* oxlint-disable react/no-children-prop */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/components/markdown/Markdown";
import { CodeBlock } from "../src/components/markdown/CodeBlock";

// —— assert framework（与项目其他 test 文件保持一致）——
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed++;
    console.error(`✗ ${msg}`);
  } else {
    console.log(`✓ ${msg}`);
  }
}

function renderMarkdown(src: string): string {
  return renderToStaticMarkup(React.createElement(Markdown, { children: src }));
}

function main(): void {
  // ─────────────── 1) CodeBlock：value 路径仍然工作（ToolCallCard 依赖） ───────────────
  console.log("=== CodeBlock: value path still works (backward compat) ===");
  {
    const html = renderToStaticMarkup(
      React.createElement(CodeBlock, {
        language: "json",
        value: '{"foo": "bar"}',
      }),
    );
    assert(html.includes("foo"), "CodeBlock renders value content");
    assert(!html.includes("[object Object]"), "CodeBlock value path has no [object Object]");
  }

  // ─────────────── 2) CodeBlock：children string 路径（markdown 路径） ───────────────
  console.log("=== CodeBlock: children (string) renders plain text ===");
  {
    const html = renderToStaticMarkup(
      React.createElement(CodeBlock, {
        language: "python",
        children: 'def greet(name):\n    print("hello")',
      }),
    );
    // SSR 阶段 worker 还没响应，所以渲染 plain text
    assert(html.includes("def"), "CodeBlock renders text from children");
    assert(html.includes("print"), "CodeBlock renders text content from children");
    assert(!html.includes("[object Object]"), "CodeBlock children path has no [object Object]");
  }

  // ─────────────── 3) CodeBlock：value 优先（markdown 路径走 children，tool 走 value） ───────────────
  console.log("=== CodeBlock: value precedence ===");
  {
    const html = renderToStaticMarkup(
      React.createElement(CodeBlock, {
        language: "text",
        value: "VALUE_STRING",
        children: "CHILD_STRING",
      }),
    );
    // 当前实现：markdown 路径用 children，tool 路径用 value；两者都传时 children 优先
    assert(html.includes("CHILD_STRING"), "CodeBlock uses children when both provided");
    assert(!html.includes("VALUE_STRING"), "CodeBlock ignores value when children present");
  }

  // ─────────────── 4) Markdown：fenced code block 不再出现 "[object Object]" ───────────────
  console.log("=== Markdown: fenced code block no longer leaks [object Object] ===");
  {
    const src = [
      "Here's some Python:",
      "",
      "```python",
      "def greet(name):",
      '    print(f"Hello, {name}!")',
      "",
      "greet('World')",
      "```",
      "",
    ].join("\n");

    const html = renderMarkdown(src);

    assert(
      !html.includes("[object Object]"),
      "Markdown fenced code block does NOT contain '[object Object]'"
    );
    assert(html.includes("def"), "Markdown fenced code block still contains 'def'");
    assert(html.includes("print"), "Markdown fenced code block still contains 'print'");
    assert(
      html.includes("Hello,"),
      "Markdown fenced code block still contains f-string content 'Hello,'"
    );
    // 高亮走 worker，SSR 阶段还没有 hljs- 类
    assert(
      !html.includes("[object Object]"),
      "Markdown fenced code block has no '[object Object]'"
    );
  }

  // ─────────────── 5) Markdown：inline code 仍然正常 ───────────────
  console.log("=== Markdown: inline code still works ===");
  {
    const html = renderMarkdown("Use `npm install` to install.");
    assert(html.includes("npm install"), "Markdown inline code still renders text");
    assert(!html.includes("[object Object]"), "Markdown inline code has no [object Object]");
    assert(
      html.includes("rounded bg-muted"),
      "Markdown inline code uses inline styling class"
    );
  }

  // ─────────────── 6) Markdown：JSON / 多行代码块 ───────────────
  console.log("=== Markdown: json / multi-line code blocks ===");
  {
    const src = "```json\n{\"users\":[{\"id\":1,\"name\":\"Alice\"}]}\n```";
    const html = renderMarkdown(src);
    assert(!html.includes("[object Object]"), "JSON code block has no [object Object]");
    assert(html.includes("users"), "JSON code block still contains 'users'");
    assert(html.includes("Alice"), "JSON code block still contains 'Alice'");
  }

  // ─────────────── 7) Markdown：未知语言 code block ───────────────
  console.log("=== Markdown: unknown language code block ===");
  {
    const src = "```\nplain text content\n```";
    const html = renderMarkdown(src);
    assert(!html.includes("[object Object]"), "Plain fenced code block has no [object Object]");
    assert(
      html.includes("plain") && html.includes("text") && html.includes("content"),
      "Plain fenced code block preserves all words from original text"
    );
  }

  // ─────────────── 8) Markdown：多 fenced block 互不干扰 ───────────────
  console.log("=== Markdown: multiple fenced blocks ===");
  {
    const src = [
      "```js",
      "const x = 1;",
      "```",
      "",
      "between",
      "",
      "```py",
      "y = 2",
      "```",
    ].join("\n");
    const html = renderMarkdown(src);
    assert(html.includes("const x = 1"), "first block content preserved");
    assert(html.includes("y = 2"), "second block content preserved");
    assert(html.includes("between"), "prose between blocks preserved");
    assert(!html.includes("[object Object]"), "no [object Object] in multi-block render");
  }

  console.log(
    `\n${failed === 0 ? "all assertions passed" : `${failed} assertions failed`}`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});