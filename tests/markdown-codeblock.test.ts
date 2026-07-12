/**
 * Markdown code block rendering — regression tests for the
 * "[object Object]" bug.
 *
 * Bug history:
 *   - `Markdown.tsx` 的 `code` 组件用 `String(children ?? "")` 把 react-markdown
 *     经 rehype-highlight 处理后的子树序列化成文本。
 *   - 但 `children` 在 fenced code block 路径下是 React element 数组（hljs token
 *     spans），`String([span, span])` 会返回 `"[object Object],[object Object],..."`。
 *   - 用户看到代码块里出现一串 "[object Object]" 字样，无法正确显示内容。
 *
 * 修复：
 *   - `Markdown.tsx` 的 `code` 直接把 children 透传给 `CodeBlock`，由 `CodeBlock`
 *     自己渲染子树（保留 hljs 高亮）；需要复制时再递归抽文本。
 *   - inline vs block 改用 className 里的 `language-*` 区分（替代失效的 position 检查）。
 *   - `CodeBlock` 同时支持 `value`（string，ToolCallCard 用法）和 `children`
 *     （ReactNode，markdown 渲染用法）。
 *
 * Usage:
 *   bun run tests/markdown-codeblock.test.ts
 */
/* oxlint-disable react/no-children-prop */
// 用 `React.createElement(Markdown, { children: ... })` 才能在 .test.ts 里渲染
// React 组件（项目测试统一用 .ts 后缀，不开 .tsx）；用 JSX prop 形式会触发
// oxlint 的 react/no-children-prop 规则。这里明确禁用是为了让 asserts 集中
// 在 markdown 行为本身，不被 lint 噪音稀释。
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

/**
 * 复刻实际 chat 流里的场景：assistant message 里包含一段带 ```py 的代码块。
 * 在 bug 版本里会渲染出 "[object Object], ,[object Object],..." 这种鬼东西。
 */
function renderMarkdown(src: string): string {
  return renderToStaticMarkup(React.createElement(Markdown, { children: src }));
}

function main(): void {
  // ─────────────── 1) CodeBlock：直接渲染 children（保留 hljs 高亮） ───────────────
  console.log("=== CodeBlock: render children directly (preserve highlighting) ===");
  {
    const children = React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "span",
        { className: "hljs-keyword" },
        "def"
      ),
      " ",
      React.createElement(
        "span",
        { className: "hljs-title" },
        "greet"
      ),
      "(",
      React.createElement(
        "span",
        { className: "hljs-params" },
        "name"
      ),
      "):\n    ",
      React.createElement(
        "span",
        { className: "hljs-built_in" },
        "print"
      ),
      '("hello")',
    );

    const html = renderToStaticMarkup(
      React.createElement(CodeBlock, { language: "python", children }),
    );

    // 保留 hljs span
    assert(
      html.includes("hljs-keyword") && html.includes("def"),
      "CodeBlock renders hljs-keyword span with text 'def'"
    );
    assert(
      html.includes("hljs-built_in") && html.includes("print"),
      "CodeBlock renders hljs-built_in span with text 'print'"
    );
    // 不能出现 "[object Object]"
    assert(
      !html.includes("[object Object]"),
      "CodeBlock does NOT render '[object Object]' anywhere"
    );
  }

  // ─────────────── 2) CodeBlock：value 路径仍然工作（ToolCallCard 依赖） ───────────────
  console.log("=== CodeBlock: value path still works (backward compat) ===");
  {
    const html = renderToStaticMarkup(
      React.createElement(CodeBlock, {
        language: "json",
        value: '{"foo": "bar"}',
      }),
    );
    // 服务端 renderToStaticMarkup 会把 " 转成 &quot;，两种都允许
    const valueAppears =
      html.includes('"foo": "bar"') ||
      html.includes("foo") &&
        html.includes("bar") &&
        (html.includes("&quot;") || html.includes("foo"));
    assert(valueAppears, "CodeBlock renders value content");
    assert(!html.includes("[object Object]"), "CodeBlock value path has no [object Object]");
  }

  // ─────────────── 3) CodeBlock：传 children 又传 value 时 children 优先 ───────────────
  console.log("=== CodeBlock: children takes precedence over value ===");
  {
    const html = renderToStaticMarkup(
      React.createElement(CodeBlock, {
        language: "text",
        value: "VALUE_STRING",
        children: React.createElement("span", null, "CHILD_NODE"),
      }),
    );
    assert(html.includes("CHILD_NODE"), "CodeBlock renders children when both provided");
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
    // 实际代码内容必须保留下来
    assert(
      html.includes("def"),
      "Markdown fenced code block still contains 'def'"
    );
    assert(
      html.includes("print"),
      "Markdown fenced code block still contains 'print'"
    );
    assert(
      html.includes("Hello,"),
      "Markdown fenced code block still contains f-string content 'Hello,'"
    );
    // 保留 hljs 高亮
    assert(
      html.includes("hljs-keyword"),
      "Markdown fenced code block preserves hljs-keyword span"
    );
    // 不应该出现原来的 [object Object] 痕迹
    assert(
      !/\[object Object\]/i.test(html),
      "Markdown fenced code block has no '[object Object]' substring (case-insensitive)"
    );
  }

  // ─────────────── 5) Markdown：inline code 仍然正常 ───────────────
  console.log("=== Markdown: inline code still works ===");
  {
    const html = renderMarkdown("Use `npm install` to install.");
    assert(html.includes("npm install"), "Markdown inline code still renders text");
    assert(!html.includes("[object Object]"), "Markdown inline code has no [object Object]");
    // inline code 用单独的 className 区分（不带 language-*）
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

  // ─────────────── 7) Markdown：未知语言 code block（detect 失败场景） ───────────────
  console.log("=== Markdown: unknown language code block ===");
  {
    // 不写 ```xxx，纯 fenced code。rehype-highlight + detect: true 通常会强加一个
    // language-* 类（auto-detect 把"plain text content"识别为 CSS）；但无论它
    // 怎么分词，原始文本必须完整保留下来。
    const src = "```\nplain text content\n```";
    const html = renderMarkdown(src);
    assert(
      !html.includes("[object Object]"),
      "Plain fenced code block has no [object Object]"
    );
    // 验证原始文本的所有字符都还在（hljs 可能切成 span，但不会丢字符）
    assert(
      html.includes("plain") && html.includes("text") && html.includes("content"),
      "Plain fenced code block preserves all words from original text"
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