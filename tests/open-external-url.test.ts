/**
 * Tests for open-external-url — 重点覆盖 isSafeExternalUrl 的协议白名单。
 * openExternalUrl 调 Tauri runtime，没法单测；它的"非安全 URL 不调用"分支
 * 通过 isSafeExternalUrl 的拒绝行为 + console.warn 路径间接保证。
 *
 * Usage:
 *   bun run test (or) bun run tests/open-external-url.test.ts
 */
import { isSafeExternalUrl } from "../src/lib/open-external-url";

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

async function main(): Promise<void> {
  // ───────────────────── 允许的安全协议 ─────────────────────
  {
    const allowed = [
      "http://example.com",
      "https://example.com",
      "https://example.com/path?q=1#frag",
      "https://docs.example.com/api/v2/users",
      "http://localhost:3000/foo",
      "http://127.0.0.1:8080",
      "https://10.0.0.1",
      "https://user:pass@example.com",
      "mailto:foo@example.com",
      "mailto:foo+tag@sub.example.com",
    ];
    for (const url of allowed) {
      assert(
        isSafeExternalUrl(url) === true,
        `accepts safe url: ${url}`
      );
    }
  }

  // ───────────────────── 拒绝的危险协议 ─────────────────────
  {
    const rejected = [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "FILE:///etc/passwd",
      "data:text/html,<script>alert(1)</script>",
      "data:text/plain;base64,SGVsbG8=",
      "about:blank",
      "ftp://example.com",
      "ssh://example.com",
      "tel:+15551234567",
      "chrome://settings",
      "blob:https://example.com/abc",
    ];
    for (const url of rejected) {
      assert(
        isSafeExternalUrl(url) === false,
        `rejects unsafe url: ${url}`
      );
    }
  }

  // ───────────────────── 拒绝畸形 / 非法输入 ─────────────────────
  {
    const cases: Array<[string, unknown]> = [
      ["empty string", ""],
      ["whitespace only", "   "],
      ["relative path", "/foo/bar"],
      ["bare hostname", "example.com"],
      ["not a url", "not a url at all"],
      ["protocol-relative", "//example.com/foo"],
      ["null", null],
      ["undefined", undefined],
      ["number", 42],
      ["object", { url: "https://example.com" }],
      ["array", ["https://example.com"]],
      ["boolean", true],
    ];
    for (const [label, input] of cases) {
      assert(
        isSafeExternalUrl(input as any) === false,
        `rejects malformed input: ${label}`
      );
    }
  }

  // ───────────────────── 边角：trim + 大小写 ─────────────────────
  {
    // markdown 偶尔会在 href 两端留空格：[link]( https://example.com )
    assert(
      isSafeExternalUrl("  https://example.com  ") === true,
      "trims whitespace before validating https url"
    );
    assert(
      isSafeExternalUrl("  javascript:alert(1)  ") === false,
      "javascript: with leading whitespace still rejected"
    );
    // URL 解析对 protocol 不区分大小写——这里 JS 的 URL 实现会规整为 javascript:
    // 所以白名单判定仍然有效。
    assert(
      isSafeExternalUrl("JAVASCRIPT:alert(1)") === false,
      "JavaScript: with uppercase still rejected"
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