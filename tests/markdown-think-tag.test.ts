/**
 * markdown-think-tag.test.ts
 *
 * Regression for: "The tag <think> is unrecognized in this browser" in console.
 *
 * Background: React 19 拒绝渲染不带连字符的未知 HTML tag。某些 reasoning model
 * （DeepSeek R1 / Qwen QwQ / 自行拼 XML 的 agent）在 messages[].content 里
 * 直接吐 <think>...</think> 而不是走 AGNO 的 reasoning_content event——rehype-raw
 * 把它当 HTML 元素透传给 React 就炸。
 *
 * Markdown.tsx 在 react-markdown 的 components map 里 override `think`，
 * 渲染成浅灰背景 + 小字号的简单 block（跟 ReasoningBlock 同款风格）。
 *
 * 这里用 react-dom/server 的 renderToString（不需要 jsdom），确认：
 *   1. 含 <think>...</think> 的 markdown 能 SSR 成功（React 19 不抛 unknown tag）
 *   2. 输出里包含 think 的内部文本（override 生效、内容保留）
 *   3. 没有 details/summary（已简化为 always-visible block）
 *   4. 浅灰 + 小字号的样式 class 出现在 className 里
 *   5. 正常的 markdown（无 think tag）不受影响
 *
 * 用 createElement 而不是 JSX，因为 test runner 是 `bun run .ts`（JSX 默认关）。
 */

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Markdown } from "../src/components/markdown/Markdown";

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.log(`✗ ${msg}`);
    failed++;
  }
}

function run() {
  console.log("=== Markdown: <think> tag handling ===");

  // 1. renderToString 不抛错（关键）
  let html: string;
  try {
    html = renderToString(
      createElement(
        Markdown,
        null,
        "<think>\nLet me reason about this carefully.\n</think>\n\nHello, this is the answer."
      )
    );
    assert(true, "renderToString 成功（无 unknown tag 错误）");
  } catch (e) {
    assert(false, `renderToString 抛错: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  // 2. think 内容保留（override 生效）
  assert(html.includes("Let me reason about this carefully."), "think 内部文本保留");

  // 3. 简化为 always-visible block（无 details/summary）
  assert(!html.includes("<details"), "不渲染 <details>");
  assert(!html.includes("<summary"), "不渲染 <summary>");

  // 4. 浅灰背景 + 小字号 class 出现
  assert(
    html.includes("bg-muted/40") || html.includes("bg-muted\\/40"),
    "浅灰背景 class 出现"
  );
  assert(html.includes("text-[11.5px]") || html.includes("text-[11.5px]"), "小字号 class 出现");

  // 5. think 之后的 markdown 正常
  assert(html.includes("Hello, this is the answer."), "think 之后的 markdown 正常渲染");

  // 6. 没有 think tag 时不受影响
  console.log("\n=== Markdown: 普通 markdown 不受影响 ===");
  const normalHtml = renderToString(
    createElement(Markdown, null, "普通文本 **加粗** 和 `code`。")
  );
  assert(!normalHtml.includes("Let me reason"), "无 think tag 时不渲染 think 内容");
  assert(
    !normalHtml.includes("bg-muted/40") || !normalHtml.includes("bg-muted\\/40"),
    "无 think tag 时不应用浅灰背景"
  );
  assert(normalHtml.includes("<strong>加粗</strong>"), "普通 markdown 仍正常 parse");

  // 7. think block 单独存在
  console.log("\n=== Markdown: think block 嵌套内容保留 ===");
  const nestedHtml = renderToString(
    createElement(
      Markdown,
      null,
      "<think>\nStep 1: do this.\nStep 2: do that.\n</think>"
    )
  );
  assert(nestedHtml.includes("Step 1: do this."), "think 嵌套内容保留");
  assert(nestedHtml.includes("Step 2: do that."), "think 第二段保留");

  console.log(
    `\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`
  );
  process.exit(failed === 0 ? 0 : 1);
}

run();