/**
 * file-fetcher — fetch wrapper for the file-preview-panel feature.
 *
 * 用 createFetcher() 拿到 Tauri-safe 的 fetch（Tauri runtime 自动用
 * tauri-plugin-http 绕过 CORS，浏览器用 window.fetch），加一层：
 *   - 5 MB 默认上限（Content-Length 头 + streaming guard）
 *   - 错误归一化为 FileFetchError { code: 'cors' | 'notfound' | 'toobig' | 'network' }
 *   - 非 UTF-8 响应回落到 latin1 解码（一些 plain log 不是 utf-8）
 *   - mime 推断：优先 Content-Type 头，否则按扩展名
 *
 * 仅适用于文本类（md / text / code）。image / html 不走此函数 —— 它们
 * 直接由 <img>/<iframe> 标签 fetch，没有大小限制风险。
 */

import { detectPreviewKind } from "./preview-kind";
import { createFetcher } from "./tauri-fetch";

export type FileFetchErrorCode = "cors" | "notfound" | "toobig" | "network";

export class FileFetchError extends Error {
  readonly code: FileFetchErrorCode;
  readonly status?: number;
  readonly url: string;
  constructor(
    code: FileFetchErrorCode,
    message: string,
    opts: { status?: number; url: string } = { url: "" }
  ) {
    super(message);
    this.name = "FileFetchError";
    this.code = code;
    if (opts.status != null) this.status = opts.status;
    this.url = opts.url;
  }
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export interface FileFetcherOptions {
  /** 注入测试用 fetcher。默认走 createFetcher()。 */
  fetcher?: typeof fetch;
  /** 字节上限；默认 5 MB。 */
  maxBytes?: number;
  /** AbortSignal —— 取消时 fetch 立即停止，已读字节丢弃。 */
  signal?: AbortSignal;
}

/**
 * 抓 URL 的文本内容。返回 `{ content, mime }`。
 * 失败抛 FileFetchError，code 已经分类好（cors / notfound / toobig / network）。
 */
export async function fetchPreviewContent(
  url: string,
  opts: FileFetcherOptions = {}
): Promise<{ content: string; mime: string }> {
  const { fetcher, maxBytes = DEFAULT_MAX_BYTES, signal } = opts;
  const f = fetcher ?? createFetcher();

  let res: Response;
  try {
    res = await f(url, signal ? { signal } : undefined);
  } catch (err) {
    throw classifyFetchError(err, url);
  }

  if (!res.ok) {
    const code: FileFetchErrorCode = res.status === 404 ? "notfound" : "network";
    throw new FileFetchError(code, `HTTP ${res.status} ${res.statusText}`, {
      status: res.status,
      url,
    });
  }

  // Content-Length 头先查（绝大多数静态文件服务器会带）。超过直接拒绝，避免
  // 把几个 GB 的日志全拉到内存里。
  const clHeader = res.headers.get("content-length");
  if (clHeader != null) {
    const declared = Number(clHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new FileFetchError(
        "toobig",
        `File is ${declared} bytes, exceeds limit of ${maxBytes}`,
        { status: res.status, url }
      );
    }
  }

  // 真正的 read。逐块累积，超上限立刻抛。latin1 fallback 在末尾。
  // 当声明大小已知时一次性分配，节省反复扩容
  const declared = clHeader != null ? Number(clHeader) : NaN;
  const out = Number.isFinite(declared) && declared <= maxBytes
    ? new Uint8Array(Math.max(0, declared))
    : new Uint8Array(0);

  if (out.length === 0) {
    // 走 streaming guard：用 reader 累加
    const reader = res.body?.getReader();
    if (!reader) {
      throw new FileFetchError("network", "Response has no body reader", { url });
    }
    let total = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // ignore — best effort
        }
        throw new FileFetchError(
          "toobig",
          `File exceeds ${maxBytes} bytes while reading`,
          { url }
        );
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.byteLength;
    }
    return {
      content: decodeBytes(merged),
      mime: pickMime(res.headers.get("content-type"), url),
    };
  }

  // 已知大小，一次性读
  const reader = res.body?.getReader();
  if (!reader) {
    throw new FileFetchError("network", "Response has no body reader", { url });
  }
  let off = 0;
  while (off < out.length) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, off);
    off += value.byteLength;
  }
  return {
    content: decodeBytes(out.subarray(0, off)),
    mime: pickMime(res.headers.get("content-type"), url),
  };
}

// ───────────────────── helpers ─────────────────────

function classifyFetchError(err: unknown, url: string): FileFetchError {
  if (err instanceof FileFetchError) return err;
  if (err instanceof TypeError) {
    const msg = err.message ?? "";
    if (/cors|access-control|cross-origin/i.test(msg)) {
      return new FileFetchError("cors", `CORS blocked: ${msg}`, { url });
    }
    // 浏览器对网络/协议错误统一抛 TypeError("Failed to fetch") 等
    return new FileFetchError("network", msg || "fetch failed", { url });
  }
  if (err instanceof Error) {
    return new FileFetchError("network", err.message, { url });
  }
  return new FileFetchError("network", "Unknown fetch error", { url });
}

const EXT_TO_MIME: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  log: "text/plain",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  xml: "application/xml",
  toml: "application/toml",
  conf: "text/plain",
  ini: "text/plain",
  env: "text/plain",
  py: "text/x-python",
  ts: "text/typescript",
  tsx: "text/tsx",
  js: "text/javascript",
  jsx: "text/jsx",
  mjs: "text/javascript",
  cjs: "text/javascript",
  go: "text/x-go",
  rs: "text/x-rust",
  java: "text/x-java",
  c: "text/x-c",
  h: "text/x-c",
  cpp: "text/x-c++",
  cc: "text/x-c++",
  cxx: "text/x-c++",
  hpp: "text/x-c++",
  cs: "text/x-csharp",
  rb: "text/x-ruby",
  php: "text/x-php",
  sh: "text/x-shellscript",
  bash: "text/x-shellscript",
  zsh: "text/x-shellscript",
  fish: "text/x-shellscript",
  sql: "text/x-sql",
  kt: "text/x-kotlin",
  swift: "text/x-swift",
  scala: "text/x-scala",
};

function pickMime(contentTypeHeader: string | null, url: string): string {
  if (contentTypeHeader) {
    // strip charset / boundary params
    return contentTypeHeader.split(";")[0].trim().toLowerCase();
  }
  const kind = detectPreviewKind(url);
  if (kind === "md") return "text/markdown";
  if (kind === "text") return "text/plain";
  if (kind === "code") {
    // 用扩展名推断（detectPreviewKind 已经做了 case-insensitive 解析）
    let path = url;
    const hash = path.indexOf("#");
    if (hash !== -1) path = path.slice(0, hash);
    const q = path.indexOf("?");
    if (q !== -1) path = path.slice(0, q);
    const lastSlash = path.lastIndexOf("/");
    const lastSeg = lastSlash === -1 ? path : path.slice(lastSlash + 1);
    const dot = lastSeg.lastIndexOf(".");
    if (dot === -1 || dot === lastSeg.length - 1) return "text/plain";
    const ext = lastSeg.slice(dot + 1).toLowerCase();
    return EXT_TO_MIME[ext] ?? "text/plain";
  }
  return "text/plain";
}

/**
 * 解码字节：先尝试 UTF-8（含 BOM 直接接受），失败回落到 latin1。
 * latin1 是 1:1 字节映射，任何字节序列都能解，不抛。
 */
function decodeBytes(bytes: Uint8Array): string {
  // BOM 直接切掉
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}