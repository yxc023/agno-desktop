# Changelog

All notable changes to Agno Desktop are documented here. Versions follow [Semantic Versioning](https://semver.org/).

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