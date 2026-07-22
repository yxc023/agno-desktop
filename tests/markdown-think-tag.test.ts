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
 * 渲染成 <details> 可折叠块。
 *
 * 这里用 react-dom/server 的 renderToString（不需要 jsdom），确认：
 *   1. 含 <think>...</think> 的 markdown 能 SSR 成功（React 19 不抛 unknown tag）
 *   2. 输出里包含 "推理过程" 和 content（说明 override 生效）
 *   3. <details>/<summary> 元素正确生成
 *   4. 正常的 markdown（无 think tag）不受影响
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

  // 2. override 生效：可折叠 details 块
  assert(html.includes("推理过程"), "包含 '推理过程' 摘要");
  assert(html.includes("<details"), "渲染为 <details> 元素");
  assert(html.includes("<summary"), "包含 <summary>");
  assert(html.includes("Let me reason about this carefully."), "think 内部文本保留");

  // 3. 外部 markdown 正常
  assert(html.includes("Hello, this is the answer."), "think 之后的 markdown 正常渲染");

  // 4. 没有 think tag 时不受影响
  console.log("\n=== Markdown: 普通 markdown 不受影响 ===");
  const normalHtml = renderToString(
    createElement(Markdown, null, "普通文本 **加粗** 和 `code`。")
  );
  assert(!normalHtml.includes("<details"), "无 think tag 时不渲染 details");
  assert(!normalHtml.includes("推理过程"), "无 think tag 时不渲染 summary");
  assert(normalHtml.includes("<strong>加粗</strong>"), "普通 markdown 仍正常 parse");

  // 5. think block 单独存在
  console.log("\n=== Markdown: think block 嵌套内容保留 ===");
  const nestedHtml = renderToString(
    createElement(
      Markdown,
      null,
      "<think>\nStep 1: do this.\nStep 2: do that.\n</think>"
    )
  );
  assert(nestedHtml.includes("Step 1: do this."), "think 嵌套内容保留");
  assert(nestedHtml.includes("推理过程"), "summary 出现");

  console.log(
    `\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`
  );
  process.exit(failed === 0 ? 0 : 1);
}

run();