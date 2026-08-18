/**
 * Tauri runtime fetcher selection (package version).
 *
 * In the browser, uses globalThis.fetch directly.
 * Consumers that bundle this package inside Tauri can swap in
 * @tauri-apps/plugin-http's fetch at their level.
 */
export function createFetcher(): typeof fetch {
  return globalThis.fetch.bind(globalThis);
}
