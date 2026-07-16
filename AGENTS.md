# AGENTS.md

> Instructions for AI coding agents (and humans) working on Agno Desktop.

Note: the requested filename was `AGENTA.md`; this file is at the standard
`AGENTS.md` path. Rename with `git mv AGENTS.md AGENTA.md` if the literal
spelling is required.

---

## 1. What this is

Agno Desktop is a **local-first, multi-instance desktop client for AGNO AgentOS**.
Open the app → add an AGNO instance → pick an agent → chat. Streams SSE, renders
tool calls / reasoning / markdown, supports HITL approval and resume.

- Web build: Vite + React 19 SPA
- Desktop build: same web bundle inside a Tauri 2 shell (bypasses browser CORS)
- Persistence: `localStorage` only — no backend, no telemetry
- Package manager: **bun** (npm/pnpm/yarn also work)

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| UI framework | React 19 + React Router 7 |
| Bundler / dev | Vite 8 + `@vitejs/plugin-react` |
| Language | TypeScript 6 (`strict`, `verbatimModuleSyntax`, `moduleResolution: bundler`) |
| Styling | Tailwind CSS 4 (CSS-first config in `src/index.css`; **no `tailwind.config.js`**) |
| Components | Radix UI primitives + shadcn-style wrappers in `src/components/ui/` |
| State | Zustand 5 (one store per domain in `src/stores/`) |
| Markdown | react-markdown + remark-gfm + remark-breaks + rehype-highlight |
| Code highlight | highlight.js (`github-dark` theme) |
| Icons | lucide-react |
| Layout | react-resizable-panels |
| Toasts | sonner |
| Desktop | Tauri 2 (`src-tauri/`), plugins: updater, shell, process, http |
| Lint | oxlint (not ESLint) |
| Tests | bun:test (`bun run test`) |

---

## 3. Common commands

```bash
bun install              # install deps
bun run dev              # browser dev (http://127.0.0.1:5173)
bun run dev:desktop      # Tauri desktop dev (webview on :5180)
bun run build            # type-check + Vite bundle (→ dist/)
bun run build:desktop    # full desktop bundle → src-tauri/target/release/bundle/
bun run lint             # oxlint
bun run typecheck        # tsc -b --noEmit
bun run test             # bun:test, all tests in tests/

# Custom AGNO backend (default: http://127.0.0.1:8000)
AGNO_PROXY_TARGET=http://192.168.1.100:8000 bun run dev
```

> **Port note:** browser dev uses 5173, Tauri dev uses 5180 (set via
> `TAURI_DEV_PORT` in `tauri.conf.json → build.beforeDevCommand`). Don't
> unify them — Tauri WKWebView has focus races when the dev server reloads.

---

## 4. Project layout

```
agno-desktop/
├── src/
│   ├── main.tsx, App.tsx, index.css
│   ├── components/
│   │   ├── ui/          # shadcn-style base components (button, dialog, …)
│   │   ├── layout/      # AppShell, AppTitleBar
│   │   ├── chat/        # ChatPanel, MessageBubble, ReasoningBlock, ToolCallCard, ApprovalDialog, MessageInput
│   │   ├── sessions/    # SessionList
│   │   ├── instances/   # InstanceFormDialog, InstancesPanel
│   │   ├── markdown/    # Markdown, CodeBlock
│   │   └── common/      # Logo
│   ├── lib/             # Pure logic (no React)
│   │   ├── agno-client.ts        # AGNO HTTP client
│   │   ├── agno-types.ts         # AGNO API types
│   │   ├── sse-parser.ts         # SSE → events
│   │   ├── chat-runner.ts        # Event reducer → message parts
│   │   ├── message-types*.ts     # Frontend message model
│   │   ├── model-context-windows.ts  # Token-limit lookup for the progress ring; fetches models.dev/api.json (24h localStorage cache), falls back to built-in MODEL_CONTEXT_WINDOWS
│   │   ├── updater.ts            # Tauri updater wrappers
│   │   ├── storage.ts            # localStorage helpers
│   │   ├── tauri.ts, tauri-fetch.ts   # Capability detection
│   │   └── utils.ts              # cn, format, debounce, copy
│   ├── stores/          # Zustand stores (one per domain)
│   │   ├── instances-store.ts, sessions-store.ts, chat-store.ts,
│   │   ├── settings-store.ts, ui-store.ts, updater-store.ts
│   ├── pages/           # ChatPage, InstancesPage, MemoryPage, SettingsPage, WelcomeScreen, NotFoundPage
│   ├── hooks/, types/   # reserved (currently empty)
├── src-tauri/           # Rust backend
│   ├── src/             # main.rs, lib.rs + custom commands (install_update)
│   ├── capabilities/    # ACL files (one per plugin surface)
│   ├── tauri.conf.json
│   └── Cargo.toml
├── scripts/             # Dev tooling (bun run scripts/*)
│   ├── test.ts, build-desktop.ts, probe-agno-8083.ts, diagnose-scroll-issue.js
├── tests/               # bun:test files (*.test.ts). Mirror src/lib/ naming.
├── docs/
│   ├── design.md        # Architecture, data flow
│   ├── api-mapping.md   # AGNO OpenAPI ↔ frontend
│   └── screenshots/
├── .github/workflows/
│   ├── ci.yml           # typecheck + lint + test + build on PR/push
│   └── release.yml      # tag push → 3-platform build + draft release
├── vite.config.ts       # /api proxy → AGNO (env: AGNO_PROXY_TARGET)
└── package.json         # version field is source of truth for web
```

---

## 5. Code conventions

- **TS strict mode is on.** `verbatimModuleSyntax: true` → use `import type { Foo }` for type-only imports.
- **Path alias:** `@/*` → `src/*`. Prefer over deep relative imports.
- **No `tailwind.config.js`** — Tailwind v4 config lives in `src/index.css` (CSS-first). Adding tokens? Update CSS variables there, not a JS config.
- **UI primitives** live in `src/components/ui/` and follow shadcn conventions (Radix + cva + `cn()` from `lib/utils.ts`). Add new primitives there before building feature components.
- **State:** prefer extending the existing Zustand store for the domain over ad-hoc `useState`. Stores already expose derived selectors — read the store file before adding new fields.
- **Tests live next to the thing they test by name**, but in the top-level `tests/` dir (bun:test convention used here). Mirror `src/lib/<file>.ts` with `tests/<file>.test.ts`.
- **No comments in code** unless something is genuinely non-obvious (Tauri focus races, CORS workarounds, AGNO field quirks are acceptable exceptions).
- **UI strings are Chinese.** New user-visible strings should match the existing tone (concise, technical, Chinese).
- **One file, one responsibility.** `chat-runner.ts` (~26 KB) is intentionally a single reducer — don't split it unless adding a clearly distinct reducer.

---

## 6. Architecture notes

### Data flow (chat)

```
AGNO SSE stream
  → sse-parser.ts          (bytes → typed events)
  → chat-runner.ts         (events → message parts via reducer)
  → chat-store.ts          (parts → zustand state, exposes selectors)
  → ChatPanel / MessageBubble
```

The runner is a pure reducer over `RunnerEvent`. Adding a new AGNO event type:
add to `agno-types.ts`, handle in `chat-runner.ts`, render in `MessageBubble.tsx`.

### Stores

| Store | Owns |
|---|---|
| `instances-store` | List of AGNO instances (CRUD, active selection) |
| `sessions-store` | Per-instance/agent session list, search/rename/delete |
| `chat-store` | Active session messages + runner state |
| `settings-store` | User preferences (theme, auto-update toggle, …) |
| `ui-store` | Ephemeral UI state (panels, modals) |
| `updater-store` | Tauri updater state (shared globally — see 0.0.5 release note) |

### CORS — the single biggest gotcha

AGNO server only allows `https://app.agno.com` by default. The Vite dev
proxy (`/api/*` → `AGNO_PROXY_TARGET`) strips `Origin`/`Referer` and adds
`x-accel-buffering: no` for SSE. The app surfaces CORS errors with a clear
hint in the UI; do **not** swallow them.

### Tauri capability model

Each plugin surface needs an entry in `src-tauri/capabilities/*.json`. If a
new `core:foo:allow-bar` capability is needed, add it explicitly — Rust
commands exposed via `tauri::generate_handler!` are denied by default.

---

## 7. Releasing a new version

Three files must bump in lockstep:

1. `package.json` → `version`
2. `src-tauri/Cargo.toml` → `version`
3. `src-tauri/tauri.conf.json` → `version`

Then:

```bash
# Update CHANGELOG.md (add a new top entry following existing format)
git commit -am "chore: bump version to 0.0.X"
git push
git tag v0.0.X
git push --tags      # triggers .github/workflows/release.yml
```

CI builds macOS (aarch64) + Windows (x86_64) bundles, signs with the
private key in repo secrets, and creates a draft GitHub Release with
`latest.json`. Publish the draft manually.

**Local desktop build** needs `~/.tauri/keys/agno-desktop.{key,key.pub,key.password}`
(`cargo tauri signer generate -w ~/.tauri/keys/agno-desktop.key`). `bun run build:desktop`
will tell you exactly what's missing.

---

## 8. Known pitfalls (read before touching)

- **WKWebView drag-region focus race** — `data-tauri-drag-region` doesn't start
  dragging on first click after a focus change. The fix (post-0.0.6) is
  `getCurrentWindow().startDragging()` in `onMouseDown`. See `AppTitleBar.tsx`.
- **`Cross-device link (os error 18)` on install** — `/Applications` and
  `$TMPDIR` on different APFS volumes. Fixed by custom `install_update`
  command in `src-tauri/src/lib.rs` (uses `tempfile_in(install_parent)` +
  AppleScript `mv -f`). Don't revert to `tauri-plugin-updater`'s default.
- **Updater state must live in a global store** — local `useState` causes
  components to desync (see 0.0.5 release note; `useUpdaterStore` exists for
  this reason).
- **Apple code-signing / notarization is intentionally off.** First-launch
  users must right-click → Open. Don't "fix" this without a real cert.
- **macOS build is Apple Silicon only.** No Intel binary is produced.
- **Markdown code blocks always render with `github-dark`** regardless of
  app theme. Intentional (and noted as a known issue in README).

---

## 9. Reference docs

- `README.md` — user-facing setup, CORS workarounds, release flow
- `docs/design.md` — architecture, data flow, UI design rationale
- `docs/api-mapping.md` — every AGNO endpoint → frontend usage
- `CHANGELOG.md` — per-version change log; read the current top entry before
  touching recently-fixed areas

When making non-trivial changes, update `docs/design.md` if architecture
moves and add a `CHANGELOG.md` entry following the existing style
(`### Added` / `### Fixed` / `### Notes` with `file_path:line_number`
references and link to upstream issues where relevant).