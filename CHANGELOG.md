# Changelog

All notable changes to Agno Desktop are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.0.7] - 2026-07-16

### Added
- **Model context windows now load from a JSON config file** at `public/config/model-context-windows.json`. The lookup in `src/lib/model-context-windows.ts:174` now consults three sources in order: remote JSON overlay → built-in map → `DEFAULT_CONTEXT_WINDOW`. The remote file is fetched on app boot via `loadRemoteContextWindows()` in `src/App.tsx:42`, with results cached in `localStorage` under `agno:model-context-windows` for 24h. On fetch failure with a stale cache present, the stale cache is used as a lifeline; on failure with no cache, the lookup silently falls back to the built-in map. To add or correct a model's context window, edit the JSON file in `public/config/` and open a PR — no client release needed.
- `tests/model-context-windows.test.ts` covering exact / longest-prefix lookup, case-insensitivity, remote-overlay precedence over the built-in map, cache TTL behavior, fetch-failure fallback paths, payload validation, concurrent-load de-duplication, and `formatTokenCount`.

### Fixed
- **Context progress bar was always showing the 128k default** for AGNO instances where the agent endpoint returns a wrapper name (e.g. `OpenAiChat`) instead of the real LLM model id. The real model id only appears in the `ModelRequestCompleted` SSE event (same event that already carries `input_tokens`). The runner callback `onModelRequestCompleted` at `src/lib/chat-runner.ts:43` now also forwards `data.model`; `chat-store.ts` stores it in a new `latestModelIdBySession` map and exposes `useLatestModelId(sessionId)`; `ContextProgressBar` at `src/components/chat/ContextProgressBar.tsx:159` prefers the per-session id over `agent.model.name` and only falls back to the agent-endpoint name when the SSE id is not yet available (new session before the first LLM response). After the first exchange the ring snaps to the correct window from the JSON config.
- **History-only sessions now also show the correct model window** (not just the first new exchange after my fix above). `loadHistory` at `src/stores/chat-store.ts:1581` now scans `runs[].events[]` for the most recent `ModelRequestCompleted` event and reads its `model` field, writing it to `latestModelIdBySession` next to `latestInputTokensBySession`. Visiting an old session immediately shows the correct window, no new LLM call required. If the AGNO version doesn't persist `events[]` or omits the `model` field, `latestModelId` stays null and ContextProgressBar falls back to `agent.model.name` as before.
- **Mixed-case map keys (e.g. `MiniMax-M2.7`) now match correctly**. Previously the lookup lowercased only the input side, leaving `MODEL_CONTEXT_WINDOWS` and remote-JSON keys in their original mixed case — so AGNO returning `MiniMax-M2.7` would lowercase to `MiniMax-m2.7` and miss the stored `MiniMax-M2.7` entry, falling back to the 128k default. `LOOKUP_BUILTIN` is now built once at module init with all keys lowercased (`src/lib/model-context-windows.ts:179`), and `validateConfig` lowercases incoming JSON keys at the same time. Regression tests in `tests/model-context-windows.test.ts:159` cover `MiniMax-M2.7`, `MINIMAX-M2.7`, snapshot-prefix variants, and remote-JSON mixed-case keys.

### Added
- **2026 model lineup** synced into both `public/config/model-context-windows.json` (remote source of truth) and `src/lib/model-context-windows.ts` (built-in fallback):
  - **Qwen 3.6** (2026-03): `qwen3.6-plus`, `qwen3.6-plus-preview`, `qwen3.6-max` — all **1M tokens** (per official "100 万上下文" announcement).
  - **Doubao** (ByteDance): `doubao-1.5-pro` / `-256k` (256k), `-32k` (32k), `doubao-1.5-lite` (256k), `doubao-1.5-vision-pro` (128k), `doubao-1.8` (256k), `doubao-2.1` / `-pro` (256k), `doubao-seed-code` (128k), `doubao-seed-2.0-lite` (128k). Doubao entries marked `TODO: 确认精确值` should be cross-checked against `https://www.volcengine.com/docs/82379` before relying on them.
  - **MiniMax M3** (2026-06): `MiniMax-M3`, `MiniMax-M3-preview` — **1M tokens** via MiniMax's sparse attention (MSA) architecture; confirmed by official release notes and the third-party `cc-haha` commit "set MiniMax-M3 default context to 1m".

  JSON total: 102 → 117 entries. The two files must stay in lockstep — see `tests/model-context-windows.test.ts:186` for spot checks of each new model.

### Changed
- **Replaced hand-rolled `public/config/model-context-windows.json` with [models.dev](https://models.dev)** as the canonical remote data source. The app now fetches `https://models.dev/api.json` on boot (24h localStorage cache under `agno:models-dev-catalog`, schema = SST-managed). New models and updated context windows propagate automatically without a client release.
  - **CORS is wide open** (`Access-Control-Allow-Origin: *`), so the SPA fetches it directly — no Vite proxy needed. Cloudflare CDN with `must-revalidate`.
  - **Adapter** (`src/lib/model-context-windows.ts:303`): flattens the nested `{providerId: {models: {[id]: {limit: {context}}}}}` into a flat `{[bareModelId]: ModelContextEntry}`. Filter-out: `*-token-plan` / `*-coding-plan` / `*-cn` provider variants (commercial plans / regional endpoints, not separate models). Cross-provider duplicate model ids: first-wins dedup.
  - **Built-in `MODEL_CONTEXT_WINDOWS` retained** as the pure offline fallback. 117 entries, covers mainstream providers for the "first launch before fetch completes" / "Cloudflare is down" cases. The two layers share a common key normalization step (lowercase at load time) so the lookup is case-insensitive across both.
  - **Two values were corrected** to match models.dev: `qwen3.6-max` (was 1M, now 262k) and `MiniMax-M3` (was 1M, now 512k — 512k guaranteed, 1M is the published peak).

### Notes
- The built-in `MODEL_CONTEXT_WINDOWS` table in `src/lib/model-context-windows.ts` is intentionally kept as an offline fallback. The JSON file and the built-in table should stay in sync; new entries go in both places.

## [0.0.6] - 2026-07-14

### Fixed
- **Custom titlebar couldn't drag the window on the first click after a focus change.** macOS WKWebView has a known focus race: when a mousedown on a `data-tauri-drag-region` element would also need to make the window the key window, macOS captures the click for the focus transition and the WKWebView never sees the full drag gesture, so the drag doesn't start. Workaround: `AppTitleBar`'s `onMouseDown` now explicitly calls `getCurrentWindow().startDragging()` via IPC, which sends the drag-start command straight to the native window and bypasses the webview's focus race. Sub-elements (restart button / download progress / error chip) use `closest('[data-tauri-drag-region="false"]')` to opt out so button clicks still work. Requires the new `core:window:allow-start-dragging` capability.
  - Reference: https://github.com/tauri-apps/tauri/issues/11605, https://github.com/tauri-apps/tauri/issues/4316

### Notes
- No user-facing behavior change for any other part of the app; this is a one-bug patch release.

## [0.0.5] - 2026-07-14

### Fixed
- **Update UI now actually works**: `useUpdater()`'s state was held in component-local `useState`, so AppTitleBar's instance never saw status changes triggered by SettingsPage or UpdateToast. Moved state to a global zustand store (`useUpdaterStore`) so all subscribers share one source of truth. Auto-check now fires once per app session instead of once per hook instance.
- **Restart button did nothing on click**: `@tauri-apps/plugin-process` was imported on the JS side but the Rust plugin was never registered and the capability was never granted. Clicking "重启" silently failed (the error was swallowed by `try { ... } catch {}`). Now: `tauri-plugin-process` is registered, `process:default` + `process:allow-restart` are granted, and restart failures surface as an error chip in the title bar instead of being silently dropped.
- **Install failed with `Cross-device link (os error 18)`** on Macs where `/Applications` and `/var/folders` are on different APFS volumes. `tauri-plugin-updater@2.10.1`'s macOS `install_inner` does `fs::rename()` to a tempdir in default `$TMPDIR` and only escalates to AppleScript on `PermissionDenied` — `EXDEV` was returned as a hard error. Replaced with a custom `install_update` Rust command that uses `tempfile_in(install_parent)` (forces same volume) and AppleScript `mv -f` with admin privileges (cross-device safe + handles root-owned `/Applications`).

### Added
- Error chip in title bar shows `更新失败 · 重试` with user-friendly tooltip when update fails (previously errors only showed in SettingsPage, invisible from chat/dashboard).
- `setError(message)` action on `useUpdaterStore` for explicit error transitions (e.g., relaunch failure).
- `scripts/build-desktop.ts` wraps `tauri build` to auto-source `TAURI_SIGNING_PRIVATE_KEY` from `~/.tauri/keys/` and validate pubkey match — fixes "A public key has been found, but no private key" for local builds.

### Notes
- macOS install now pops a one-time admin password prompt (only if installed to `/Applications`). User-owned paths (`~/Applications`) install without prompting.
- `bun run build:desktop` now requires `cargo tauri signer generate` to have been run at least once (the script will tell you exactly how). Keypair at `~/.tauri/keys/agno-desktop.{key,key.pub,key.password}` must exist and pubkey must match `tauri.conf.json`.

## [0.0.4] - 2026-07-13

### Added
- `CHANGELOG.md` to track release notes going forward

### Notes
- No functional changes from 0.0.3
- This release exists primarily to exercise the auto-update pipeline (0.0.3 → 0.0.4)

## [0.0.3] - 2026-07-13

### Added
- **Auto-updater** via `tauri-plugin-updater`
  - Startup silent check (24h throttle, settings toggle to disable)
  - Settings page → manual "立即检查" button
  - Bottom-right toast on new version, dialog with progress bar during download
  - macOS / Linux: auto-relaunch after download; Windows: MSI installer + manual relaunch
  - Signing chain: pubkey embedded at compile time, private key only in CI/local secrets
  - Browser / mobile / dev mode: graceful no-op with toast feedback (no more silent dead buttons)
  - Error normalization: network / signature / permission failures → user-readable Chinese phrases

- **GitHub Actions** for CI + release
  - `ci.yml`: PR / push to main triggers typecheck + lint + test + build (5-8 min)
  - `release.yml`: tag `v*` push triggers 3-platform build + auto-sign + draft GitHub Release (15-25 min)
  - Matrix: macOS Apple Silicon (.dmg), Linux x86_64 (.AppImage), Windows x86_64 (.msi)
  - Static `latest.json` served from GitHub Releases; updater endpoint points there

- **Release pipeline docs** in README (key generation, signing, secrets configuration)

### Fixed
- markdown code block rendering no longer leaks `[object Object]`

### Notes
- macOS dmg is **not Apple code-signed / notarized** — first launch requires right-click → Open
- Only `darwin-aarch64` (Apple Silicon) is built for macOS; x86_64 not included
- Linux and Windows binaries produced by CI but **not** validated end-to-end at release time

## [0.0.2] - 2026-07-10

### Highlights
- **Tighter chat UI**: `<hr>` spacing reduced; message area widened from 768px → 896px
- **Context progress ring** in chat header (compact 18px SVG; hover for details)
  - Per-call token semantics (`AGNO ModelRequestCompleted.input_tokens`), not the cumulative `run.metrics.input_tokens`
  - Color-graded by usage: green (healthy) → amber → orange → red (critical)
- **External links open in system browser** (Tauri `shell.open` plugin)
- **History rebuilt from `runs[]`** when `chat_history` is empty (server-side persistence gap workaround)
- **Sessions**: copy session id button + dropdown menu
- **IME safety**: Enter inside IME composition no longer triggers send

### Changelog
- `feat(chat)`: tighter hr spacing, wider message area, context progress ring
- `feat(tauri)`: enable shell.open plugin for external link handling
- `feat(chat)`: open markdown / reference / search links in system browser
- `fix(chat)`: rebuild history from runs when chat_history is empty
- `feat(sessions)`: add copy session id button + dropdown menu
- `chore(test)`: wire up bun test runner + path alias resolution

## [0.0.1] - 2026-07-09

Initial public release. Multi-instance local desktop client for AGNO AgentOS.

- Multi-instance management (dev / staging / prod switching)
- Agent listing + session management per agent
- SSE streaming chat with tool call visualization
- Markdown + code highlighting (github-dark)
- Web search results rendered as clickable cards
- Local-first (zero telemetry; everything in localStorage)