# Changelog

All notable changes to Agno Desktop are documented here. Versions follow [Semantic Versioning](https://semver.org/).

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