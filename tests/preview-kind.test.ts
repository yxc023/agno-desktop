/**
 * Tests for detectPreviewKind — URL → PreviewKind mapping.
 *
 * The function is a pure classifier: given an href string, return one of
 * "md" | "text" | "code" | "image" | "html" | null. null means "no preview,
 * fall back to openExternalUrl".
 *
 * Coverage:
 *  - happy paths per kind (md, text, image, html, code)
 *  - case insensitivity on extension
 *  - query string + fragment stripping
 *  - directory components in path are ignored
 *  - extensions are taken from the LAST path segment only
 *  - non-string / empty / whitespace → null
 *  - unparseable / no-extension URLs → null
 *  - common source extensions + structured-data extensions → code
 *
 * Usage:
 *   bun run test (or) bun run tests/preview-kind.test.ts
 */
import { detectPreviewKind, resolvePreviewUrl } from "../src/lib/preview-kind";

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
  // ───────────────────── md / markdown ─────────────────────
  {
    const cases = [
      "https://example.com/notes.md",
      "https://example.com/path/to/README.markdown",
      "https://example.com/foo.MD",                  // case insensitive
      "https://example.com/notes.md?v=1",            // query stripped
      "https://example.com/notes.md#anchor",         // fragment stripped
      "https://example.com/notes.md?foo=bar#baz",    // both stripped
    ];
    for (const url of cases) {
      assert(
        detectPreviewKind(url) === "md",
        `md: ${url}`
      );
    }
  }

  // ───────────────────── text / log ─────────────────────
  {
    const cases = [
      "https://example.com/notes.txt",
      "https://example.com/app.log",
      "https://example.com/logs/2026-08-06.LOG",
    ];
    for (const url of cases) {
      assert(
        detectPreviewKind(url) === "text",
        `text: ${url}`
      );
    }
  }

  // ───────────────────── image ─────────────────────
  {
    const cases = [
      ["https://example.com/a.png", "image"],
      ["https://example.com/a.JPG", "image"],
      ["https://example.com/a.jpeg", "image"],
      ["https://example.com/a.gif", "image"],
      ["https://example.com/a.webp", "image"],
      ["https://example.com/a.svg", "image"],
    ] as const;
    for (const [url, expected] of cases) {
      assert(
        detectPreviewKind(url) === expected,
        `image: ${url}`
      );
    }
  }

  // ───────────────────── html ─────────────────────
  {
    const cases = [
      "https://example.com/page.html",
      "https://example.com/page.htm",
      "https://example.com/PAGE.HTML",
    ];
    for (const url of cases) {
      assert(
        detectPreviewKind(url) === "html",
        `html: ${url}`
      );
    }
  }

  // ───────────────────── code / structured ─────────────────────
  {
    const cases = [
      "https://example.com/data.json",
      "https://example.com/data.yaml",
      "https://example.com/data.yml",
      "https://example.com/data.csv",
      "https://example.com/data.tsv",
      "https://example.com/data.xml",
      "https://example.com/data.toml",
      "https://example.com/Cargo.toml",
      "https://example.com/script.py",
      "https://example.com/component.tsx",
      "https://example.com/main.go",
      "https://example.com/lib.rs",
      "https://example.com/Main.java",
      "https://example.com/app.cpp",
      "https://example.com/run.sh",
      "https://example.com/run.bash",
      "https://example.com/run.zsh",
      "https://example.com/query.sql",
      "https://example.com/config.ini",
      "https://example.com/.env",
    ];
    for (const url of cases) {
      assert(
        detectPreviewKind(url) === "code",
        `code: ${url}`
      );
    }
  }

  // ───────────────────── extension comes from last path segment ─────────────────────
  {
    // path has a "." earlier but the actual file extension is .md
    assert(
      detectPreviewKind("https://example.com/v1.2/notes.md") === "md",
      "extension from last segment: v1.2/notes.md"
    );
    // query string contains dots; must NOT be treated as extension
    assert(
      detectPreviewKind("https://example.com/path?file=note.txt") === null,
      "query param 'file=note.txt' must not be treated as extension"
    );
  }

  // ───────────────────── null for non-previewable ─────────────────────
  {
    const cases = [
      "https://example.com",                       // no extension, no path
      "https://example.com/",                      // trailing slash, no file
      "https://example.com/path/to/page",          // no extension
      "https://example.com/path/to/",              // trailing slash
      "https://example.com/article",               // bare path
      "https://api.example.com/v1/users/42",       // looks like an API URL
      "https://github.com/user/repo",             // repo page
    ];
    for (const url of cases) {
      assert(
        detectPreviewKind(url) === null,
        `null for non-previewable: ${url}`
      );
    }
  }

  // ───────────────────── malformed / non-string input ─────────────────────
  {
    const cases: Array<[string, unknown]> = [
      ["empty string", ""],
      ["whitespace only", "   "],
      ["null", null],
      ["undefined", undefined],
      ["number", 42],
      ["object", { url: "https://example.com/x.md" }],
      ["array", ["https://example.com/x.md"]],
      ["boolean", true],
    ];
    for (const [label, input] of cases) {
      assert(
        detectPreviewKind(input as any) === null,
        `null for malformed input: ${label}`
      );
    }
  }

  // ───────────────────── resolvePreviewUrl — agent 输出非全 URL 时的解析 ─────────────────────
  // 实际场景：AGNO agent 有时返回的不是 https:// 开头的完整 URL，而是
  //   - file_path:requirements/foo.md （自定义 scheme）
  //   - //requirements/foo.md          （protocol-relative）
  //   - /requirements/foo.md           （absolute path）
  // 这些都意图指向「当前 AGNO 实例上的资源」。解析规则：去掉前缀，拼到当前
  // 实例的 baseUrl 后面。baseUrl 可能是完整的 http(s)://host:port、可能是
  // Vite 代理路径 /api、也可能带/不带尾斜杠。

  {
    // ── file_path: 自定义 scheme ──
    assert(
      resolvePreviewUrl(
        "file_path:requirements/foo.md",
        "http://192.168.1.5:8000"
      ) === "http://192.168.1.5:8000/requirements/foo.md",
      "file_path:rest with full baseUrl"
    );
    assert(
      resolvePreviewUrl(
        "file_path:/requirements/foo.md",
        "http://192.168.1.5:8000"
      ) === "http://192.168.1.5:8000/requirements/foo.md",
      "file_path:/rest (extra leading slash)"
    );
    assert(
      resolvePreviewUrl("file_path:foo.md", "http://x:8000") ===
        "http://x:8000/foo.md",
      "file_path: bare name (still prepend /)"
    );
    assert(
      resolvePreviewUrl("file_path:requirements/foo.md", "/api") ===
        "/api/requirements/foo.md",
      "file_path: + Vite proxy baseUrl"
    );

    // ── // protocol-relative ──
    assert(
      resolvePreviewUrl("//requirements/foo.md", "http://x:8000") ===
        "http://x:8000/requirements/foo.md",
      "//path with full baseUrl"
    );
    assert(
      resolvePreviewUrl("//requirements/foo.md", "/api") ===
        "/api/requirements/foo.md",
      "//path with Vite proxy baseUrl"
    );

    // ── / absolute path ──
    assert(
      resolvePreviewUrl("/requirements/foo.md", "http://x:8000") ===
        "http://x:8000/requirements/foo.md",
      "/path with full baseUrl"
    );
    assert(
      resolvePreviewUrl("/requirements/foo.md", "/api") ===
        "/api/requirements/foo.md",
      "/path with Vite proxy baseUrl"
    );

    // ── full URL pass-through ──
    assert(
      resolvePreviewUrl("https://other/foo.md", "http://x:8000") ===
        "https://other/foo.md",
      "full https URL untouched"
    );
    assert(
      resolvePreviewUrl("http://other/foo.md", "http://x:8000") ===
        "http://other/foo.md",
      "full http URL untouched"
    );

    // ── trailing slash on baseUrl ──
    assert(
      resolvePreviewUrl("/foo.md", "http://x:8000/") === "http://x:8000/foo.md",
      "baseUrl trailing slash is normalized"
    );
    assert(
      resolvePreviewUrl("file_path:foo.md", "http://x:8000/") ===
        "http://x:8000/foo.md",
      "file_path: + baseUrl trailing slash"
    );

    // ── empty / invalid baseUrl → pass-through ──
    assert(
      resolvePreviewUrl("/foo.md", "") === "/foo.md",
      "empty baseUrl: pass-through"
    );
    assert(
      resolvePreviewUrl("file_path:foo.md", "") === "file_path:foo.md",
      "empty baseUrl: file_path: pass-through"
    );

    // ── non-string input ──
    assert(
      resolvePreviewUrl(null as any, "http://x") === null,
      "null href: pass-through"
    );
    assert(
      resolvePreviewUrl(undefined as any, "http://x") === undefined,
      "undefined href: pass-through"
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