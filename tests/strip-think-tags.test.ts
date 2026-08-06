/**
 * Tests for stripThinkTags — 把模型 inline 推理标签从 text 字符串里去掉
 *
 * 用手写 assert + counter（项目约定），不用 bun:test。
 */

import { stripThinkTags } from "../src/lib/strip-think-tags";

let failed = 0;
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failed++;
    console.error(`✗ ${msg}\n   expected: ${e}\n   actual:   ${a}`);
  } else {
    console.log(`✓ ${msg}`);
  }
}
function assertSame(actual: unknown, msg: string): void {
  if (typeof actual !== "string") {
    failed++;
    console.error(`✗ ${msg} (not a string)`);
  } else {
    console.log(`✓ ${msg}`);
  }
}

/* ---------------------------------------------------------------- */
/* 成对 block                                                          */
/* ---------------------------------------------------------------- */

console.log("paired blocks:");
assertEq(
  stripThinkTags("<think>foo</think>"),
  "",
  "paired single line → empty"
);
assertEq(
  stripThinkTags("<think>foo</think>hello"),
  "hello",
  "paired + trailing content → trailing only"
);
assertEq(
  stripThinkTags("hello<think>foo</think>world"),
  "helloworld",
  "paired + leading + trailing"
);
assertEq(
  stripThinkTags("<think>line1\nline2\nline3</think>"),
  "",
  "paired multiline → empty"
);
assertEq(
  stripThinkTags("<think>\nfoo\n</think>bar"),
  "bar",
  "paired multiline + trailing"
);
assertEq(
  stripThinkTags("<think>a</think><think>b</think>"),
  "",
  "two consecutive pairs → empty"
);
assertEq(
  stripThinkTags("<think>a</think> middle <think>b</think>"),
  " middle ",
  "two pairs with content between"
);
assertEq(
  stripThinkTags("<think>\n\n</think>"),
  "",
  "paired empty content"
);

/* ---------------------------------------------------------------- */
/* 嵌套                                                                */
/* ---------------------------------------------------------------- */

console.log("\nnested:");
assertEq(
  stripThinkTags("<think><think>x</think></think>"),
  "",
  "nested simple (inner first, outer exposed) → empty"
);
assertEq(
  stripThinkTags("<think><think><think>x</think></think></think>"),
  "",
  "triple nested → empty"
);
assertEq(
  stripThinkTags("<think>outer<think>inner</think>mid</think>trail"),
  "trail",
  "nested + surrounding text"
);

/* ---------------------------------------------------------------- */
/* 未闭合 open + 孤儿 close                                            */
/* ---------------------------------------------------------------- */

console.log("\nunclosed / orphan:");
assertEq(
  stripThinkTags("<think>foo"),
  "",
  "unclosed open → strip from open to end"
);
assertEq(
  stripThinkTags("<think>foo\nbar\nbaz"),
  "",
  "unclosed open multiline → strip from open to end"
);
assertEq(
  stripThinkTags("hello<think>foo"),
  "hello",
  "unclosed open with leading content"
);
assertEq(
  stripThinkTags("foo</think>bar"),
  "foobar",
  "orphan close → just delete the close tag"
);
assertEq(
  stripThinkTags("foo</think>bar</think>baz"),
  "foobarbaz",
  "multiple orphan closes"
);

/* ---------------------------------------------------------------- */
/* 大小写 + 跨标签名                                                   */
/* ---------------------------------------------------------------- */

console.log("\ncase + tag-name variants:");
assertEq(
  stripThinkTags("<THINK>foo</think>"),
  "",
  "uppercase open"
);
assertEq(
  stripThinkTags("<think>foo</THINK>"),
  "",
  "uppercase close"
);
assertEq(
  stripThinkTags("<Think>foo</Think>"),
  "",
  "mixed case"
);
assertEq(
  stripThinkTags("<thinking>foo</thinking>"),
  "",
  "<thinking> variant"
);
assertEq(
  stripThinkTags("<thinking>foo</think>"),
  "",
  "<thinking> open with </think> close (mismatched but stripped)"
);
assertEq(
  stripThinkTags("<reasoning>foo</reasoning>"),
  "",
  "<reasoning> variant"
);
assertEq(
  stripThinkTags("<REASONING>foo</REASONING>"),
  "",
  "<REASONING> uppercase"
);
assertEq(
  stripThinkTags("<think>a</think><reasoning>b</reasoning>c"),
  "c",
  "mixed tag types in same text"
);
assertEq(
  stripThinkTags("<think>a</think><thinking>b</thinking><reasoning>c</reasoning>d"),
  "d",
  "three tag types"
);

/* ---------------------------------------------------------------- */
/* 包含 markdown / 代码片段                                            */
/* ---------------------------------------------------------------- */

console.log("\nrich content:");
assertEq(
  stripThinkTags("<think>**bold** *em* `code`</think>"),
  "",
  "paired with markdown"
);
assertEq(
  stripThinkTags("<think>```ts\nconst x = 1;\n```</think>result"),
  "result",
  "paired with code block"
);
assertEq(
  stripThinkTags("<think># heading\n- item</think>done"),
  "done",
  "paired with markdown list/heading"
);

/* ---------------------------------------------------------------- */
/* 不变性                                                              */
/* ---------------------------------------------------------------- */

console.log("\ninvariants:");
assertEq(stripThinkTags(""), "", "empty string → empty");
assertEq(
  stripThinkTags("hello world"),
  "hello world",
  "no tags → unchanged"
);
assertEq(
  stripThinkTags("<think>not a tag"),
  "",
  "streaming partial: text ends mid-think → all stripped"
);
assertEq(
  stripThinkTags("<think>step 1</think>answer 1<think>step 2</think>answer 2"),
  "answer 1answer 2",
  "alternating think/answer"
);
assertEq(
  stripThinkTags("think no tags here"),
  "think no tags here",
  "literal 'think' word (no angle brackets) preserved"
);
assertSame(
  stripThinkTags(""),
  "always returns a string"
);
assertSame(
  stripThinkTags("<think></think>"),
  "empty think returns a string"
);

/* ---------------------------------------------------------------- */
/* 副作用测试 (idempotent)                                             */
/* ---------------------------------------------------------------- */

console.log("\nidempotent:");
{
  const input = "<think>foo</think>bar<reasoning>baz</reasoning>";
  const once = stripThinkTags(input);
  const twice = stripThinkTags(once);
  assertEq(twice, once, "stripThinkTags(stripThinkTags(x)) === stripThinkTags(x)");
}

console.log(
  `\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`
);
process.exit(failed === 0 ? 0 : 1);