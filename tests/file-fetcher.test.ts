/**
 * Tests for fetchPreviewContent — wraps fetch() with:
 *  - 5 MB default cap (configurable via opts.maxBytes)
 *  - Error code mapping (cors / notfound / toobig / network)
 *  - latin1 fallback when the body fails UTF-8 decode
 *  - Tauri-safe fetcher via createFetcher() by default
 *
 * Usage:
 *   bun run test (or) bun run tests/file-fetcher.test.ts
 */
import {
  fetchPreviewContent,
  FileFetchError,
  type FileFetchErrorCode,
} from "../src/lib/file-fetcher";

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed++;
    console.error(`✗ ${msg}`);
  } else {
    console.log(`✓ ${msg}`);
  }
}

// ───────────────────── test helpers ─────────────────────

function makeResponse(
  body: string | Uint8Array,
  init: {
    status?: number;
    contentType?: string;
    contentLength?: number;
  } = {}
): Response {
  const status = init.status ?? 200;
  const headers = new Headers();
  if (init.contentType) headers.set("content-type", init.contentType);
  if (init.contentLength != null) headers.set("content-length", String(init.contentLength));
  return new Response(body, { status, headers });
}

function fetcherOf(responses: Array<Response | Error>): typeof fetch {
  let i = 0;
  return (async (_url: string) => {
    const r = responses[i++];
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
}

async function main(): Promise<void> {
  // ───────────────────── happy path ─────────────────────
  {
    const fetcher = fetcherOf([makeResponse("# hello\nworld", { contentType: "text/markdown; charset=utf-8" })]);
    const result = await fetchPreviewContent("https://example.com/x.md", { fetcher });
    assert(result.content === "# hello\nworld", "happy path: content matches");
    assert(result.mime.startsWith("text/markdown"), `happy path: mime = ${result.mime}`);
  }

  // ───────────────────── 404 → notfound ─────────────────────
  {
    const fetcher = fetcherOf([makeResponse("Not Found", { status: 404 })]);
    let caught: unknown = null;
    try {
      await fetchPreviewContent("https://example.com/x.md", { fetcher });
    } catch (e) {
      caught = e;
    }
    assert(caught instanceof FileFetchError, "404: throws FileFetchError");
    assert((caught as FileFetchError)?.code === "notfound", `404: code = ${(caught as FileFetchError)?.code}`);
    assert((caught as FileFetchError)?.status === 404, "404: status preserved");
  }

  // ───────────────────── 5xx → network ─────────────────────
  {
    const fetcher = fetcherOf([makeResponse("boom", { status: 503 })]);
    let caught: unknown = null;
    try {
      await fetchPreviewContent("https://example.com/x.md", { fetcher });
    } catch (e) {
      caught = e;
    }
    assert(caught instanceof FileFetchError, "503: throws FileFetchError");
    assert((caught as FileFetchError)?.code === "network", `503: code = ${(caught as FileFetchError)?.code}`);
  }

  // ───────────────────── fetch reject (network failure) → network ─────────────────────
  {
    const fetcher = fetcherOf([new TypeError("Failed to fetch")]);
    let caught: unknown = null;
    try {
      await fetchPreviewContent("https://example.com/x.md", { fetcher });
    } catch (e) {
      caught = e;
    }
    assert(caught instanceof FileFetchError, "fetch reject: throws FileFetchError");
    assert((caught as FileFetchError)?.code === "network", `fetch reject: code = ${(caught as FileFetchError)?.code}`);
  }

  // ───────────────────── CORS error (TypeError with specific message) → cors ─────────────────────
  {
    const fetcher = fetcherOf([new TypeError("CORS: Access-Control-Allow-Origin mismatch")]);
    let caught: unknown = null;
    try {
      await fetchPreviewContent("https://example.com/x.md", { fetcher });
    } catch (e) {
      caught = e;
    }
    assert(caught instanceof FileFetchError, "CORS: throws FileFetchError");
    assert((caught as FileFetchError)?.code === "cors", `CORS: code = ${(caught as FileFetchError)?.code}`);
  }

  // ───────────────────── toobig via Content-Length ─────────────────────
  {
    const fetcher = fetcherOf([
      makeResponse("ignored", { contentLength: 6 * 1024 * 1024 }),
    ]);
    let caught: unknown = null;
    try {
      await fetchPreviewContent("https://example.com/x.md", { fetcher });
    } catch (e) {
      caught = e;
    }
    assert(caught instanceof FileFetchError, "toobig: throws FileFetchError");
    assert((caught as FileFetchError)?.code === "toobig", `toobig: code = ${(caught as FileFetchError)?.code}`);
  }

  // ───────────────────── toobig via streaming guard (no Content-Length, body grows past cap) ─────────────────────
  {
    // 1 MB chunk × 6 → 6 MB total, no Content-Length header
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new Uint8Array(1024 * 1024).fill(65); // 1 MB of 'A'
        for (let i = 0; i < 6; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
    const resp = new Response(stream, { status: 200 });
    const fetcher = fetcherOf([resp]);
    let caught: unknown = null;
    try {
      await fetchPreviewContent("https://example.com/x.md", { fetcher });
    } catch (e) {
      caught = e;
    }
    assert(caught instanceof FileFetchError, "stream-toobig: throws FileFetchError");
    assert((caught as FileFetchError)?.code === "toobig", `stream-toobig: code = ${(caught as FileFetchError)?.code}`);
  }

  // ───────────────────── maxBytes override (smaller cap) ─────────────────────
  {
    const fetcher = fetcherOf([makeResponse("hi", { contentLength: 100 })]);
    let caught: unknown = null;
    try {
      await fetchPreviewContent("https://example.com/x.md", { fetcher, maxBytes: 50 });
    } catch (e) {
      caught = e;
    }
    assert(caught instanceof FileFetchError, "small cap: throws");
    assert((caught as FileFetchError)?.code === "toobig", `small cap: code = ${(caught as FileFetchError)?.code}`);
  }

  // ───────────────────── mime inferred from extension when no header ─────────────────────
  {
    const fetcher = fetcherOf([
      makeResponse("hello", {}),
      makeResponse("{}", {}),
      makeResponse("world", {}),
    ]);
    const r1 = await fetchPreviewContent("https://example.com/x.md", { fetcher });
    assert(r1.mime === "text/markdown", `md inferred: ${r1.mime}`);
    const r2 = await fetchPreviewContent("https://example.com/x.json", { fetcher });
    assert(r2.mime === "application/json", `json inferred: ${r2.mime}`);
    const r3 = await fetchPreviewContent("https://example.com/x.txt", { fetcher });
    assert(r3.mime === "text/plain", `txt inferred: ${r3.mime}`);
  }

  // ───────────────────── content-type header wins over extension ─────────────────────
  {
    const fetcher = fetcherOf([makeResponse("{}", { contentType: "application/json; charset=utf-8" })]);
    const r = await fetchPreviewContent("https://example.com/x.md", { fetcher });
    assert(r.mime === "application/json", `header wins over ext: ${r.mime}`);
  }

  // ───────────────────── non-UTF8 body → latin1 fallback ─────────────────────
  {
    // bytes 0xC3 0xA9 is "é" in UTF-8; bytes 0xE9 alone is latin1 "é"
    // Construct bytes that are valid latin1 but invalid UTF-8 (e.g. 0xFF alone).
    const bytes = new Uint8Array([0xff, 0xfe, 0xfd, 0x41, 0x42]);
    const fetcher = fetcherOf([makeResponse(bytes, { contentType: "text/plain" })]);
    const r = await fetchPreviewContent("https://example.com/x.txt", { fetcher });
    // latin1 decode of 0xff 0xfe 0xfd 0x41 0x42 → "ÿþýAB"
    assert(r.content === "ÿþýAB", `latin1 fallback: ${[...r.content].map(c => c.charCodeAt(0).toString(16)).join(" ")}`);
  }

  // ───────────────────── FileFetchError is a proper Error subclass ─────────────────────
  {
    const e = new FileFetchError("cors", "blocked");
    assert(e instanceof Error, "FileFetchError is an Error");
    assert(e.code === "cors", "code preserved");
    assert(e.message === "blocked", "message preserved");
    assert(e.name === "FileFetchError", "name = FileFetchError");
  }

  // ───────────────────── error code union covers all expected values ─────────────────────
  {
    const codes: FileFetchErrorCode[] = ["cors", "notfound", "toobig", "network"];
    assert(codes.length === 4, "error code union: 4 values");
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