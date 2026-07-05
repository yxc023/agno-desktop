/**
 * Tauri runtime detection & version utilities.
 *
 * 在 Tauri 2 webview 中:
 * - `window.__TAURI_INTERNALS__` 是 Tauri 注入的内部对象
 * - `window.__TAURI__` 是早期版本标识,部分 plugin 仍会用
 *
 * 浏览器 dev 环境下二者都不存在。
 */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.__TAURI_INTERNALS__ !== undefined || window.__TAURI__ !== undefined)
  );
}

/**
 * 延迟 import Tauri API,避免在浏览器中 bundle 不需要的代码。
 * Tauri 2 webview 中调用此函数会自动 fallback 到 @tauri-apps/api。
 */
export async function getTauriAppVersion(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return null;
  }
}
