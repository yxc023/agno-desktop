/**
 * highlight-client.ts — 主线程单例，封装 highlight Web Worker。
 *
 * 行为：
 *   - requestHighlight(code, language, key) → Promise<string>（HTML）
 *   - per-key 取消：同一 key 来新请求时，旧的 pending 会被 supersede
 *     （Promise reject）；客户端不主动 abort 旧 worker 请求（worker 仍会跑完），
 *     主线程只在收到 response 时按 key 检查 latestId，丢弃 stale
 *   - per-(code, language) 缓存：同内容重复请求直接返回缓存
 *   - 失败 fallback：worker 失败或超时 → 返回 escape 后的纯文本 HTML
 *     （保证组件总能渲染，不会"空白"）
 *
 * 模块级单例。Vite 用 `new Worker(new URL(...), { type: 'module' })`
 * 打包 worker；SSR 环境（无 Worker）时降级到同步 inline 高亮。
 */

import type {
  HighlightRequest,
  HighlightResponse,
} from "./highlight.worker";
import hljs from "highlight.js/lib/core";

interface PendingEntry {
  resolve: (html: string) => void;
  reject: (err: Error) => void;
}

/** Web Worker 子集 —— 让我们在测试里塞 mock。 */
export interface WorkerLike {
  postMessage(msg: unknown): void;
  addEventListener(
    type: "message" | "error",
    listener: (event: { data?: unknown; message?: string }) => void
  ): void;
  removeEventListener(
    type: "message" | "error",
    listener: (event: { data?: unknown; message?: string }) => void
  ): void;
  terminate(): void;
}

export interface Client {
  request(
    code: string,
    language: string,
    key: string
  ): Promise<string>;
  clearCache(): void;
  destroy(): void;
}

let client: Client | null = null;

export function getHighlightClient(): Client {
  if (client) return client;
  client = createClient();
  return client;
}

/** 测试用：注入 mock worker 重置单例。 */
export function resetHighlightClientForTesting(): void {
  if (client) client.destroy();
  client = null;
}

function createClient(): Client {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return createInlineClient();
  }
  try {
    const worker = new Worker(
      new URL("./highlight.worker.ts", import.meta.url),
      { type: "module" }
    );
    return createWorkerClient(worker);
  } catch {
    return createInlineClient();
  }
}

function createInlineClient(): Client {
  const cache = new Map<string, string>();
  return {
    request(code, language, key) {
      const cached = cache.get(key);
      if (cached !== undefined) return Promise.resolve(cached);
      let html: string;
      try {
        html = language && hljs.getLanguage(language)
          ? hljs.highlight(code, { language, ignoreIllegals: true }).value
          : hljs.highlightAuto(code).value;
      } catch {
        html = escapeHtml(code);
      }
      cache.set(key, html);
      return Promise.resolve(html);
    },
    clearCache() {
      cache.clear();
    },
    destroy() {},
  };
}

/**
 * 接受一个 WorkerLike；测试可传 mock，生产由 createClient() 注入真实 Worker。
 *
 * 协议：
 *   - 主线程 → worker: { id, code, language }
 *   - worker → 主线程: { id, html } | { id, error }
 *   - 同一 key 多次 request：旧的 supersede（Promise reject），新的保留；
 *     worker 仍可能对旧请求产生 response，我们按 latestIdByKey 丢弃 stale。
 */
export function createWorkerClient(worker: WorkerLike): Client {
  const cache = new Map<string, string>();
  const latestIdByKey = new Map<string, number>();
  const pendingByKey = new Map<string, PendingEntry>();
  const idToKey = new Map<number, { key: string }>();
  let nextId = 0;
  let destroyed = false;

  const onMessage = (event: { data?: unknown }): void => {
    if (destroyed) return;
    const data = event.data as HighlightResponse | undefined;
    if (!data) return;
    const meta = idToKey.get(data.id);
    if (!meta) return;
    const { key } = meta;
    idToKey.delete(data.id);

    if (latestIdByKey.get(key) !== data.id) return;

    const pending = pendingByKey.get(key);
    if (!pending) return;

    if ("error" in data) {
      pending.reject(new Error(data.error));
    } else {
      cache.set(key, data.html);
      pending.resolve(data.html);
    }
    pendingByKey.delete(key);
  };

  const onError = (event: { message?: string }): void => {
    if (destroyed) return;
    for (const [, pending] of pendingByKey) {
      pending.reject(new Error(event.message || "highlight worker error"));
    }
    pendingByKey.clear();
    idToKey.clear();
    latestIdByKey.clear();
  };

  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);

  return {
    request(code, language, key) {
      if (destroyed) return Promise.resolve(escapeHtml(code));
      const cached = cache.get(key);
      if (cached !== undefined) return Promise.resolve(cached);

      const prev = pendingByKey.get(key);
      if (prev) {
        prev.reject(new Error("superseded"));
        pendingByKey.delete(key);
      }

      const id = ++nextId;
      latestIdByKey.set(key, id);
      idToKey.set(id, { key });

      const promise = new Promise<string>((resolve, reject) => {
        pendingByKey.set(key, { resolve, reject });
      });

      const req: HighlightRequest = { id, code, language };
      worker.postMessage(req);

      return promise.catch(() => {
        const fallback = escapeHtml(code);
        cache.set(key, fallback);
        return fallback;
      });
    },
    clearCache() {
      cache.clear();
    },
    destroy() {
      destroyed = true;
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.terminate();
      for (const [, pending] of pendingByKey) {
        pending.reject(new Error("client destroyed"));
      }
      pendingByKey.clear();
      idToKey.clear();
      latestIdByKey.clear();
      cache.clear();
      client = null;
    },
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}