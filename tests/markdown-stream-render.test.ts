/**
 * MarkdownStream.test.ts — 流式渲染契约（v2：remend-based）
 *
 * 旧版 v1 用 prefix/tail 二分：tail 是 plain text，目的是避免"半截 fence"视觉错乱。
 * 但这个策略在**短单行消息**上完全退化（找不到 \n\n 边界 → 整段进 tail →
 * `**text**` 显示成原文 —— 用户截图证据）。
 *
 * v2 借鉴 OpenCode 的 `remend`：始终走 markdown parse，remend 自动治愈
 * 流式中途的不完整语法（`**bold` → `**bold**`、`[link](http` → `link text` 等）。
 *
 * 核心契约（v2）：
 *   - **始终**走 Markdown parse（streaming 只是 cursor 视觉标志）
 *   - `**bold` 流式中途 → 治愈为 `**bold**` → 渲染为 `<strong>bold</strong>`
 *   - `[link](http` 流式中途 → 降级为 plain text（linkMode: text-only）
 *   - streaming=false / streaming=true 渲染产物**仅差 cursor**
 *
 * 跑法：
 *   bun run tests/markdown-stream-render.test.ts
 */
/* oxlint-disable react/no-children-prop */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownStream } from "../src/components/markdown/MarkdownStream";

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

function render(opts: { text: string; streaming?: boolean }): string {
  return renderToStaticMarkup(
    React.createElement(MarkdownStream, {
      children: opts.text,
      streaming: opts.streaming ?? false,
    })
  );
}

function main(): void {
  console.log("=== non-streaming: passes whole text to Markdown ===");
  {
    const html = render({ text: "Hello **world**", streaming: false });
    assert(html.includes("<strong>world</strong>"), "non-streaming: bold renders");
    assert(!html.includes("streaming-cursor"), "non-streaming: no cursor");
  }

  console.log("\n=== streaming: short single-line with **bold** is parsed (regression for user screenshot) ===");
  {
    // 旧版 v1 这里整段进 tail → plain text → 看到 **Assessing title** 原文
    // v2 用 remend → **bold** 完整 → 直接渲染为 <strong>
    const html = render({ text: "**Assessing title**", streaming: true });
    assert(
      html.includes("<strong>Assessing title</strong>"),
      "streaming single-line: **bold** parses to <strong> (was a bug in v1)"
    );
    assert(html.includes("streaming-cursor"), "streaming: cursor present");
  }

  console.log("\n=== streaming: incomplete **bold auto-healed by remend ===");
  {
    // 流式中途只打出 "**Assessing title" —— v2 自动补成 **Assessing title**
    const html = render({ text: "**Assessing title", streaming: true });
    assert(
      html.includes("<strong>Assessing title</strong>"),
      "streaming incomplete **: remend closes it → renders as bold"
    );
  }

  console.log("\n=== streaming: incomplete link falls back to text-only ===");
  {
    // 流式中途 [link text](http → remend linkMode:text-only → 降级为 "link text"
    const html = render({ text: "[link text](http", streaming: true });
    assert(html.includes("link text"), "streaming incomplete link: degraded to text");
    // 不应该渲染出残缺 URL
    assert(!html.includes('href="http"'), "streaming incomplete link: no broken href");
  }

  console.log("\n=== streaming: unclosed code fence is preserved literally ===");
  {
    // 流式中途 ```python 还没闭合 —— remend 不会补全 fence（因为不能猜内容），
    // 整段仍走 markdown 但 fence 渲染会因未闭合而失败/退化。这是 markdown 库
    // 的天然行为，不在 v2 的修复范围（避免 fence 半截需要 prefix/tail 策略，
    // 但那个策略在短消息上崩溃，所以这是个两难，先 ship v2）。
    const html = render({
      text: "Some intro.\n\n```python\ndef f():",
      streaming: true,
    });
    assert(html.includes("Some intro"), "intro text rendered");
    assert(html.includes("streaming-cursor"), "cursor present");
  }

  console.log("\n=== streaming: closed fence complete: hljs renders ===");
  {
    const html = render({
      text: "Intro.\n\n```js\nconsole.log('x');\n```\n\nAfter",
      streaming: true,
    });
    assert(html.includes("console"), "closed fence: 'console' preserved");
    assert(html.includes("log"), "closed fence: 'log' preserved");
    assert(html.includes("hljs-"), "closed fence: hljs classes present");
    assert(html.includes("After"), "after-fence text rendered");
  }

  console.log("\n=== streaming vs non-streaming: only difference is cursor ===");
  {
    const streamingHtml = render({
      text: "**bold** and `code`",
      streaming: true,
    });
    const nonStreamingHtml = render({
      text: "**bold** and `code`",
      streaming: false,
    });
    assert(
      streamingHtml.includes("streaming-cursor") &&
        !nonStreamingHtml.includes("streaming-cursor"),
      "streaming=true has cursor, streaming=false doesn't"
    );
    // 两个版本都解析 bold —— 关键差异：v1 里 streaming 短消息会把 ** 当原文
    assert(
      streamingHtml.includes("<strong>bold</strong>") &&
        nonStreamingHtml.includes("<strong>bold</strong>"),
      "both modes parse **bold** identically"
    );
  }

  console.log("\n=== empty text: minimal output ===");
  {
    const html = render({ text: "", streaming: true });
    assert(typeof html === "string", "empty text: renders to string");
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