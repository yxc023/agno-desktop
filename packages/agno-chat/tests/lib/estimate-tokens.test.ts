/**
 * Tests for estimateTokens — text → rough token count heuristic
 *
 * Hand-rolled assert + counter (project convention), not bun:test.
 */

import { estimateTokens } from "../../src/lib/estimate-tokens";

let failed = 0;
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    failed++;
    console.error(`✗ ${msg}\n   expected: ${expected}\n   actual:   ${actual}`);
  } else {
    console.log(`✓ ${msg}`);
  }
}

console.log("empty / non-string:");
assertEq(estimateTokens(""), 0, "empty string → 0");
assertEq(estimateTokens(null), 0, "null → 0");
assertEq(estimateTokens(undefined), 0, "undefined → 0");
assertEq(estimateTokens(123), 0, "number → 0");
assertEq(estimateTokens({}), 0, "object → 0");

console.log("\nCJK (Chinese / Japanese / Korean):");
assertEq(estimateTokens("你"), Math.ceil(1 / 1.5), "single Chinese char");
assertEq(estimateTokens("你好"), Math.ceil(2 / 1.5), "two Chinese chars");
assertEq(estimateTokens("你好世界"), Math.ceil(4 / 1.5), "four Chinese chars");
assertEq(
  estimateTokens("中文 mixed with english"),
  Math.ceil(2 / 1.5) + Math.ceil(19 / 4),
  "mixed Chinese + English (2 CJK + 19 ASCII incl. 3 spaces)"
);

console.log("\nEnglish / ASCII:");
assertEq(estimateTokens("hello"), Math.ceil(5 / 4), "5-char English → 2");
assertEq(estimateTokens("hello world"), Math.ceil(11 / 4), "11-char English");
assertEq(estimateTokens("The quick brown fox"), Math.ceil(19 / 4), "19 chars");
assertEq(estimateTokens("12345"), Math.ceil(5 / 4), "digits");

console.log("\nCJK ranges:");
assertEq(estimateTokens("ひらがな"), Math.ceil(4 / 1.5), "Hiragana");
assertEq(estimateTokens("カタカナ"), Math.ceil(4 / 1.5), "Katakana");
assertEq(estimateTokens("한글"), Math.ceil(2 / 1.5), "Hangul");

console.log("\nsymbols / punctuation / whitespace:");
assertEq(estimateTokens("---"), Math.ceil(3 / 4), "dashes");
assertEq(estimateTokens("   "), Math.ceil(3 / 4), "spaces");
assertEq(estimateTokens("```\ncode\n```"), Math.ceil(11 / 4), "code fence");
assertEq(
  estimateTokens("()[]{}<>"),
  Math.ceil(8 / 4),
  "brackets (no < > CJK match)"
);

console.log("\nstreaming-like deltas:");
{
  // 模拟 streaming:文本逐步增长
  let acc = "";
  const chunks = ["Hel", "lo ", "world", " 你好", " hello"];
  for (const c of chunks) {
    acc += c;
    const est = estimateTokens(acc);
    if (est < 0) {
      failed++;
      console.error(`✗ negative estimate for "${acc}"`);
    }
  }
  assertEq(estimateTokens("Hello world 你好 hello") > 0, true, "acc > 0 after chunks");
}

console.log("\nmulti-line / markdown:");
{
  const text = "# Title\n\n- item 1\n- item 2\n\n```ts\nconst x = 1;\n```\n";
  const e = estimateTokens(text);
  assertEq(typeof e, "number", "markdown text → number");
  assertEq(e > 0, true, "markdown text → positive");
}

console.log("\nlarge input:");
{
  const big = "x".repeat(1000);
  assertEq(estimateTokens(big), Math.ceil(1000 / 4), "1000 ASCII chars");
}
{
  const big = "中".repeat(1000);
  assertEq(estimateTokens(big), Math.ceil(1000 / 1.5), "1000 CJK chars");
}

console.log("\nmonotonic:");
{
  // 加更多内容不应该让 estimate 减少
  const a = estimateTokens("Hello world");
  const b = estimateTokens("Hello world. This is more text added now.");
  assertEq(b >= a, true, "more text → ≥ estimate");
}
{
  const a = estimateTokens("你好");
  const b = estimateTokens("你好世界测试更多字符");
  assertEq(b >= a, true, "more CJK → ≥ estimate");
}

console.log(
  `\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`
);
process.exit(failed === 0 ? 0 : 1);