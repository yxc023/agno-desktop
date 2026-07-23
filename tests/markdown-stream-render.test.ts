/**
 * MarkdownStream.test.ts — 流式渲染的 prefix/tail 行为契约
 *
 * 核心契约：
 *   - streaming=false: 整段作为 prefix 走 Markdown，无 tail
 *   - streaming=true:
 *     - 切到稳定边界：prefix 走 Markdown；tail 是 plain text + cursor
 *   - 稳定的 streaming tick：A → B 仅 tail 增长 → prefix 文本不变
 *     （等同 Markdown memo skip）
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
    // 不带 streaming：整段视为 prefix
    const html = render({ text: "Hello **world**", streaming: false });
    assert(html.includes("<strong>world</strong>"), "non-streaming: bold renders");
  }

  console.log("\n=== streaming, no boundary yet: tail contains full text ===");
  {
    // 无 \n\n，markdown-stream 把整段视为 tail → plain text + cursor
    const html = render({
      text: "Hello world still typing",
      streaming: true,
    });
    // plain text span 里包含完整文本（去掉 markdown 标签）
    assert(
      html.includes("Hello world still typing"),
      "streaming with no boundary: tail still contains full text"
    );
    assert(
      html.includes("streaming-cursor"),
      "streaming with no boundary: cursor class present"
    );
    // prefix 为空时不应走 Markdown 的 prose wrapper；用 streaming-cursor span 替代
    assert(
      !html.includes("<strong>"),
      "streaming with no boundary: no markdown bold (tail is plain text)"
    );
  }

  console.log("\n=== streaming, after \\n\\n break: split into prefix + tail ===");
  {
    // 前一段是完结的 markdown 段落，尾巴是 streaming 中
    const html = render({
      text: "First **para** done.\n\nStill typing",
      streaming: true,
    });
    assert(
      html.includes("First"),
      "streaming with break: prefix text rendered"
    );
    assert(
      html.includes("Still typing"),
      "streaming with break: tail text rendered"
    );
    assert(
      html.includes("streaming-cursor"),
      "streaming with break: cursor on tail"
    );
    // prefix 部分应包含 markdown 渲染产物（<strong>...</strong>）
    assert(
      html.includes("<strong>para</strong>"),
      "streaming with break: prefix IS parsed by Markdown (bold)"
    );
  }

  console.log("\n=== streaming, unclosed fence: prefix empty, tail = whole text ===");
  {
    // 未闭合 fence：prefix = "" (fence 之前的内容)，tail = 整个 fence
    // 此场景下 tail 是 plain text（不要让用户看到「```python」被误解析）
    const html = render({
      text: "Some intro.\n\n```python\ndef f():\n    pas",
      streaming: true,
    });
    assert(
      html.includes("Some intro."),
      "unclosed fence: prefix-intro rendered"
    );
    assert(
      html.includes("```python"),
      "unclosed fence: tail preserves the fence literal"
    );
    // 未闭合 fence 不应被 highlight.js 处理
    // （这里只能弱断言：cursor span 应在 tail 内）
    assert(html.includes("streaming-cursor"), "unclosed fence: cursor present");
  }

  console.log("\n=== streaming, closed fence complete: prefix has the fence ===");
  {
    // 已闭合的代码块 → prefix 走 Markdown，高亮走 Web Worker（async）；
    // SSR 阶段还没拿到 worker 响应，所以只渲染 plain text。
    const html = render({
      text: "Intro.\n\n```js\nconsole.log('x');\n```\n\nAfter",
      streaming: true,
    });
    assert(html.includes("console"), "closed fence: 'console' preserved in prefix");
    assert(html.includes("log"), "closed fence: 'log' preserved in prefix");
    assert(html.includes("After"), "closed fence: tail contains 'After'");
    // 高亮在 client worker 拿到响应后才出现，SSR 阶段没有 hljs-* 类；
    // 这里只断言"SSR 没崩 + 内容完整"。
    assert(!html.includes("[object Object]"), "closed fence: no [object Object]");
  }

  console.log("\n=== streaming equals false behaves identically to Markdown ===");
  {
    // streaming=false 应当走完整的 Markdown 路径；高亮仍在 worker，SSR 阶段无 hljs-*
    const a = render({
      text: "Intro.\n\n```js\nconsole.log('x');\n```",
      streaming: false,
    });
    assert(a.includes("console"), "streaming=false: 'console' rendered");
    assert(a.includes("log"), "streaming=false: 'log' rendered");
    // streaming=false 走完整 Markdown；高亮仍在 worker，SSR 阶段无 hljs-*
    assert(!a.includes("[object Object]"), "streaming=false: no [object Object]");
    // streaming=false 不应有 cursor
    assert(
      !a.includes("streaming-cursor"),
      "streaming=false: no streaming-cursor class anywhere"
    );
  }

  console.log("\n=== empty text: minimal output ===");
  {
    const html = render({ text: "", streaming: true });
    // 不报错、HTML 长度极短即可
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
