/**
 * markdown-think-tag.test.ts
 *
 * Regression for: "The tag  W is unrecognized in this browser" in console.
 *
 * Background: React 19 拒绝渲染不带连字符的未知 HTML tag。某些 reasoning model
 * （DeepSeek R1 / Qwen QwQ / 自行拼 XML 的 agent）在 messages[].content 里
 * 直接吐 W.../W 而不是走 AGNO 的 reasoning_content event——
 * rehype-raw 把它当 HTML 元素透传给 React 就炸。
 *
 * ## 渲染管线（v2）
 * Pre-split 策略：Markdown 组件入口用 regex 把 W 块先切出来，单独用 ThinkBlock
 * 包装（独立 block，不被 react-markdown 包成 inline child、不会进 `<p>`）。
 *
 * ## 为什么不用 components.override
 * 旧策略是给 react-markdown 注册 `W: ({children}) => <div>...</div>` 的
 * override。但  W 是 inline HTML in markdown → react-markdown 包成
 * `<p>` → 我们的 override 返回 `<div>` → 浏览器看到 `<p><div>` 非法嵌套，
 * 自动闭合 `<p>` 引发布局错乱（用户截图："格式显示就是有问题"）。
 *
 * 真正干净的修法是在 pre-markdown 阶段把 W 段切出来，让 think 段是独立
 * block、不会嵌进 `<p>`。这跟 opencode 的做法是一致的思路：
 *
 * ## OpenCode 是怎么做的
 * OpenCode 的 markdown 渲染（packages/session-ui/src/components/markdown.tsx）
 * 完全不用 react-markdown，而是 `marked.lexer(text)` + dangerouslySetInnerHTML
 * + morphdom 做手术刀式 DOM 更新。marked 的 lexer 默认把 HTML 当作 block-level
 * token，输出时 `W` 直接以 HTML 形式渲染成独立 block，根本不会出现在
 * `<p>` 里。这是 marked 的天然行为优势——inline HTML 这个雷 react-markdown
 * 直接踩中。
 *
 * 我们不能直接迁移到 marked（迁移成本大、跟现成 React 生态工具链冲突），
 * 但 adopt 同样的**「W 段 pre-split，不进 AST normalize 流程」**的核心思路，
 * 用 regex + 独立 ThinkBlock 组件解决。
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
  console.log("=== Markdown:  W tag handling ===");

  // 1. renderToString 不抛错（关键）
  let html: string;
  try {
    html = renderToString(
      createElement(
        Markdown,
        null,
        String.raw`Some leading text.

<thinking>
Let me reason about this carefully.
Multiple lines.
</thinking>

Trailing text with **bold**.`
      )
    );
    assert(true, "renderToString 成功（无 unknown tag 错误）");
  } catch (e) {
    assert(false, `renderToString 抛错: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  // 2. think 段被切成独立 block，不嵌进 <p>
  // 关键回归：之前是 <p><div think>，浏览器自动闭合 <p> 引发布局错乱
  const nestedInP = /<p[^>]*>[^<]*<div[^>]*text-\[11\.5px\]/.test(html);
  assert(!nestedInP, "think 段不在 <p> 内（避免 <p><div> 非法嵌套）");

  // 3. think 视觉一致：浅灰背景、小字号（跟 ReasoningBlock 同一套）
  assert(
    html.includes("bg-muted/40") && html.includes("text-[11.5px]"),
    "think block 视觉跟 ReasoningBlock 一致：bg-muted/40 + text-[11.5px]"
  );

  // 4. think 内部的 markdown 仍正常 parse（bold/code/link）
  assert(
    html.includes("Let me reason about this carefully."),
    "think 内部 text 保留"
  );
  assert(
    html.includes("Multiple lines."),
    "think 内部多行保留"
  );

  // 5. think 前后 markdown 正常
  assert(html.includes("Some leading text"), "think 之前的 markdown 正常");
  assert(
    html.includes("Trailing text") && html.includes("<strong>bold</strong>"),
    "think 之后 markdown 正常 render（bold）"
  );

  // 6. think 段前后用 <div>（block）包裹，不再是 inline in <p>
  const hasThinkDiv = /<div[^>]*text-\[11\.5px\][^>]*>/.test(html);
  assert(hasThinkDiv, "think 段是独立 <div>（不是 inline 在 <p> 内）");

  // 7. 无 think tag 时不受影响
  console.log("\n=== Markdown: 普通 markdown 不受影响 ===");
  const normalHtml = renderToString(
    createElement(Markdown, null, "普通文本 **加粗** 和 `code`。")
  );
  assert(!normalHtml.includes("text-[11.5px]"), "无 think 时不渲染 think block");
  assert(
    normalHtml.includes("<strong>加粗</strong>"),
    "普通 markdown 仍正常 parse"
  );

  // 8. think 内嵌 markdown
  console.log("\n=== Markdown: think 内嵌 markdown ===");
  const nestedHtml = renderToString(
    createElement(
      Markdown,
      null,
      String.raw`<thinking>
**bold inside think** and ` +
        "`code`" +
        String.raw` and [link](https://x.com).
</thinking>`
    )
  );
  assert(
    nestedHtml.includes("<strong>bold inside think</strong>"),
    "think 内 bold parse"
  );
  assert(
    nestedHtml.includes('href="https://x.com"'),
    "think 内 link parse"
  );
  assert(!nestedHtml.includes("text-[11.5px]").valueOf() === false, "think block 渲染了");
  // 不嵌套 <p>
  assert(
    !/<p[^>]*>[^<]*<div[^>]*text-\[11\.5px\]/.test(nestedHtml),
    "嵌套 markdown 的 think 也不嵌进 <p>"
  );

  console.log(
    `\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`
  );
  process.exit(failed === 0 ? 0 : 1);
}

run();