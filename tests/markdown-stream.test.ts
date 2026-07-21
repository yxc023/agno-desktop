/**
 * markdown-stream.test.ts — 测试 splitStreamingMarkdown 的边界判定
 *
 * 这是性能优化（流式 markdown prefix/tail 二分）的核心 unit，错了会让 UI
 * 在打字过程中突然"段落坍塌"或"列表消失"。
 *
 * 跑法：
 *   bun run tests/markdown-stream.test.ts
 */
/* oxlint-disable */

import {
  splitStreamingMarkdown,
  shouldSkipSplit,
} from "../src/components/markdown/markdown-stream";

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

function main(): void {
  console.log("=== Streaming markdown: text without any boundary ===");
  {
    // 没有 `\n\n` / list / thematic / fence —— 整段视为 tail
    const { prefix, tail } = splitStreamingMarkdown("Hello world");
    eq(prefix, "", 'single-line text has empty prefix');
    eq(tail, "Hello world", 'single-line text tail equals input');
  }
  {
    const { prefix, tail } = splitStreamingMarkdown("Single paragraph only");
    eq(prefix, "", "paragraph only: empty prefix");
    eq(tail, "Single paragraph only", "paragraph only: full tail");
  }

  console.log("\n=== Streaming markdown: paragraph break \\n\\n ===");
  {
    // 有完整段落 → prefix 含段落分隔符，tail 是 streaming 中的段落
    const text = "First paragraph.\n\nSecond paragr";
    const { prefix, tail } = splitStreamingMarkdown(text);
    eq(
      prefix,
      "First paragraph.\n\n",
      "after one full paragraph break: prefix ends with \\n\\n"
    );
    eq(
      tail,
      "Second paragr",
      "after one full paragraph break: tail is in-progress paragraph"
    );
  }
  {
    // 多段落，tail 在第二段
    const text = "P1.\n\nP2.\n\nP3 in progress";
    const { prefix, tail } = splitStreamingMarkdown(text);
    eq(prefix, "P1.\n\nP2.\n\n", "two full paragraphs: prefix captures both");
    eq(tail, "P3 in progress", "two full paragraphs: tail captures in-progress 3rd");
  }
  {
    // 段落末尾恰好是 \n\n
    const text = "P1.\n\n";
    const { prefix, tail } = splitStreamingMarkdown(text);
    eq(prefix, "P1.\n\n", "ends with \\n\\n: prefix = whole text");
    eq(tail, "", "ends with \\n\\n: tail empty");
  }

  console.log("\n=== Streaming markdown: code fence (unclosed) ===");
  {
    // 未闭合 fence 起，整段内容视为 tail（不切 fence 中间）
    const text = "Some intro text.\n\n```python\ndef f():\n    pass";
    const { prefix, tail } = splitStreamingMarkdown(text);
    eq(
      prefix,
      "Some intro text.\n\n",
      "unclosed fence: prefix = text before fence"
    );
    eq(
      tail,
      "```python\ndef f():\n    pass",
      "unclosed fence: tail = entire fence (don't split mid-fence)"
    );
  }
  {
    // 已闭合 fence 不应触发"未闭合"逻辑 —— 走 paragraph boundary 路径
    const text = "Intro.\n\n```python\nprint('hi')\n```\n\nAfter code in progress";
    const { prefix, tail } = splitStreamingMarkdown(text);
    eq(
      prefix,
      "Intro.\n\n```python\nprint('hi')\n```\n\n",
      "closed fence: prefix includes the entire code block"
    );
    eq(
      tail,
      "After code in progress",
      "closed fence: tail is the in-progress paragraph after"
    );
  }
  {
    // 多个 fenced block，第二个未闭合
    const text =
      "Intro.\n\n```js\nconsole.log('a');\n```\n\nMiddle.\n\n```ts\nconst x: number = ";
    const { prefix, tail } = splitStreamingMarkdown(text);
    eq(
      prefix,
      "Intro.\n\n```js\nconsole.log('a');\n```\n\nMiddle.\n\n",
      "second fence unclosed: prefix ends right before second fence"
    );
    eq(
      tail,
      "```ts\nconst x: number = ",
      "second fence unclosed: tail = unclosed fence + contents"
    );
  }

  console.log("\n=== Streaming markdown: ~~~ fence ===");
  {
    const text = "Intro.\n\n~~~ruby\nputs 'h";
    const { prefix, tail } = splitStreamingMarkdown(text);
    eq(
      prefix,
      "Intro.\n\n",
      "~~~ fence prefix: text before fence"
    );
    eq(tail, "~~~ruby\nputs 'h", "~~~ fence tail: full fence");
  }

  console.log("\n=== Streaming markdown: list items ===");
  {
    const text = "Intro.\n\n- first item\n- second ";
    const { prefix, tail } = splitStreamingMarkdown(text);
    // 预期：prefix 含到 "Intro.\n\n"，tail 从 "- first item..." 开始。
    // 因为 list item start 出现在第二个 \n 之后，找到的稳定边界是 "Intro.\n\n"。
    eq(prefix, "Intro.\n\n", "list: prefix still uses paragraph break first");
    eq(
      tail,
      "- first item\n- second ",
      "list: tail = list items"
    );
  }
  {
    // 仅有 list，无 paragraph break
    const text = "- foo\n- bar\n- ba";
    const { prefix, tail } = splitStreamingMarkdown(text);
    // 找最后一个 "\n- " → 即 "\n- ba" 之前
    assert(
      prefix.length < text.length && tail.length > 0,
      "list-only text: prefix/tail split happened"
    );
    assert(
      prefix.endsWith("\n- ") === false && /-\s/.test(prefix),
      "list-only: prefix ends with a list item start"
    );
  }

  console.log("\n=== Streaming markdown: ordered list ===");
  {
    const text = "Intro.\n\n1. first\n2. second ";
    const { prefix, tail } = splitStreamingMarkdown(text);
    eq(prefix, "Intro.\n\n", "ordered list: prefix = text before list");
    eq(tail, "1. first\n2. second ", "ordered list: tail = list");
  }

  console.log("\n=== Streaming markdown: thematic break --- *** ___ ===");
  {
    const text = "P1.\n\n---\n\nP2 in progress";
    const { prefix, tail } = splitStreamingMarkdown(text);
    eq(prefix, "P1.\n\n---\n\n", "thematic break: prefix includes the rule line");
    eq(tail, "P2 in progress", "thematic break: tail = in-progress");
  }
  {
    const text = "P1.\n\n***\n\nP2 ";
    const { prefix, tail } = splitStreamingMarkdown(text);
    assert(
      prefix.includes("***"),
      "thematic break (***): prefix contains the rule"
    );
    assert(tail.startsWith("P2"), "thematic break (***): tail = next paragraph");
  }
  {
    const text = "P1.\n\n___\n\nP2 ";
    const { prefix, tail } = splitStreamingMarkdown(text);
    assert(
      prefix.includes("___"),
      "thematic break (___): prefix contains the rule"
    );
  }

  console.log("\n=== Streaming markdown: empty / whitespace ===");
  {
    eq(
      splitStreamingMarkdown("").prefix,
      "",
      "empty string: empty prefix"
    );
    eq(
      splitStreamingMarkdown("").tail,
      "",
      "empty string: empty tail"
    );
  }

  console.log("\n=== shouldSkipSplit ===");
  {
    assert(
      shouldSkipSplit("") === true,
      "shouldSkipSplit: empty → skip (true)"
    );
    assert(
      shouldSkipSplit("hello world") === false,
      "shouldSkipSplit: plain text → don't skip"
    );
    assert(
      shouldSkipSplit(
        "Some text\n\n[ref]: https://example.com\n\nmore text",
      ) === true,
      "shouldSkipSplit: link ref def → skip (true)"
    );
  }

  console.log("\n=== Streaming markdown: stability across ticks ===");
  {
    // 模拟连续 tick：text 持续追加，prefix 应稳定 / 单调增长
    const ticks = [
      "Hello",
      "Hello world",
      "Hello world.\n\nFirst",
      "Hello world.\n\nFirst paragraph",
      "Hello world.\n\nFirst paragraph.\n\nSec",
      "Hello world.\n\nFirst paragraph.\n\nSecond",
    ];
    let prevPrefix = "";
    let prefixStableTicks = 0;
    for (const t of ticks) {
      const { prefix } = splitStreamingMarkdown(t);
      if (prefix === prevPrefix) prefixStableTicks++;
      assert(
        prevPrefix === "" || prefix.length >= prevPrefix.length,
        `tick "${t.slice(0, 30)}...": prefix grew or stayed`
      );
      prevPrefix = prefix;
    }
    // 验证至少有一些 tick 共享同一 prefix（前缀复用价值）
    assert(
      prefixStableTicks >= 1,
      `expected at least one stable-prefix tick (got ${prefixStableTicks})`
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
