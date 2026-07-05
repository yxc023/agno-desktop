/**
 * Tauri runtime fetcher selection.
 *
 * 在 Tauri 2 runtime 下,使用 tauri-plugin-http 的 fetch() 走 Rust HTTP 客户端,完全绕开 CORS。
 * 浏览器环境下回退到 window.fetch。
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { isTauri } from "./tauri";

/**
 * 返回一个 fetch 兼容的函数:
 * - 在浏览器: = globalThis.fetch
 * - 在 Tauri: = @tauri-apps/plugin-http 的 fetch (走 Rust)
 *
 * 两者都返回标准 Response,支持 body.getReader() (SSE 流)、signal (AbortController)。
 */
export function createFetcher(): typeof fetch {
  if (isTauri()) {
    return tauriFetch as unknown as typeof fetch;
  }
  return globalThis.fetch.bind(globalThis);
}
