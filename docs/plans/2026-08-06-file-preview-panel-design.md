# File Preview Panel — Design

Date: 2026-08-06
Status: Approved
Target version: 0.0.12

## Goal

Agent replies often contain links to static files (`.md` notes, images, code,
HTML reports). Today every `<a>` in chat routes through `openExternalUrl` and
opens the system browser — context-switching out of the conversation. This
change makes the obvious previewable files open **inside** the client in a
right-side tabbed panel, scoped per session, so the user stays in flow.

## Scope

**In (v1)**

- Auto-intercept `<a>` clicks inside Markdown content; previewable kinds
  → in-app panel; non-previewable URLs → unchanged (system browser).
- Kinds: `md`, `text` (txt/log), `code` (json/yaml/csv/xml + common source
  extensions), `image` (png/jpg/jpeg/gif/webp/svg), `html` (sandboxed iframe).
- Multi-tab panel, closable tabs, per-session scoping, empty state, error
  state with "open in browser / copy URL" fallbacks, 5 MB text cap.
- Tauri runtime: full functionality (CORS bypassed via existing
  `createFetcher()`).
- Browser runtime: external URLs with permissive CORS work; AGNO-instance
  URLs fail with a clear error and the fallbacks above. **No new proxy in
  v1.**

**Out (v1)**

- URLs inside tool-call results (`web_search` returns, etc.) — separate
  rendering path through `ToolCallCard`, deferred.
- PDFs, file editing, hot-reload.
- Cross-restart persistence of open tabs (in-memory only).
- Browser-mode CORS bypass for AGNO-instance URLs.

## Architecture

```
Markdown.tsx onClick
  → detectPreviewKind(href)
    → kind? previewFile(sessionId, href, kind)
           → ui-store: open panel + create/reuse tab + kick off fetch
    → null?  openExternalUrl(href)               // unchanged
                 ↓
            createFetcher() → text()             // md/text/code
                           → <img>/<iframe>      // image/html (browser fetches)
```

State lives in `ui-store`; the fetch happens in a thin wrapper
`src/lib/file-fetcher.ts`; the panel is a new component
`src/components/chat/FilePreviewPanel.tsx` rendered by `ChatPage`.

## Data model

```ts
// src/stores/ui-store.ts (new fields)

type PreviewKind = "md" | "text" | "code" | "image" | "html";

interface FilePreviewTab {
  id: string;             // hash(sessionId + "|" + url); same key → reuse tab
  sessionId: string;      // scoping
  url: string;
  title: string;          // basename or url tail
  kind: PreviewKind;
  state: "loading" | "loaded" | "error";
  content?: string;       // md/text/code only
  mime?: string;          // text/markdown | text/plain | …
  error?: string;
  createdAt: number;
}

filePreviewPanelOpen: boolean;
filePreviewTabs: FilePreviewTab[];
activeFileTabId: string | null;

openFilePreviewPanel()
closeFilePreviewPanel()
toggleFilePreviewPanel()
previewFile(sessionId, url, kind)        // opens panel + upserts tab + fetch
selectFileTab(tabId)
closeFileTab(tabId)                       // also clears activeFileTabId if needed
setTabLoaded(tabId, content, mime?)
setTabError(tabId, error)
```

**Selectors**

- `useFileTabsForSession(sessionId)` — filters `filePreviewTabs` by
  `sessionId`. Panel reads from this; tabs of inactive sessions stay in
  memory but don't render.
- `useActiveFileTab()` — derives from `activeFileTabId` + per-session filter.

**Persistence**: none in v1. Tabs reset on app reload (consistent with
`chat-store` message history).

## URL detection

`src/lib/preview-kind.ts`:

```ts
export function detectPreviewKind(href: string): PreviewKind | null;
```

- Strips `?query` and `#fragment` before extension check.
- Lowercase match against a static map.
- No extension or unknown → `null`.

| Extension(s)                          | Kind   |
|---------------------------------------|--------|
| `md`, `markdown`                      | `md`   |
| `txt`, `log`                          | `text` |
| `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg` | `image` |
| `html`, `htm`                         | `html` |
| `json`, `yaml`, `yml`, `csv`, `tsv`, `xml`, `toml`, `conf`, `ini`, `env` + code (py/ts/tsx/js/jsx/go/rs/java/c/cpp/cs/sh/bash/zsh/sql) | `code` |
| _(none / unknown)_                    | `null` |

## Interception point

`src/components/markdown/Markdown.tsx:96-115` — current `<a>` component:

```tsx
onClick={(e) => {
  e.preventDefault();
  e.stopPropagation();
  const kind = detectPreviewKind(href);
  if (kind) {
    // sessionId is injected via new optional prop on <Markdown>
    previewFile(sessionId ?? "_global", href, kind);
  } else {
    void openExternalUrl(href);
  }
}}
```

`Markdown` gains an optional `sessionId?: string` prop. `MessageBubble`
(for AssistantMessage) and `MessageContent` (for sub-agent panel) inject
`message.sessionId`. UserMessage currently doesn't render `Markdown` for
links-from-user, but prop is optional so no breakage.

For the `references` part (`MessageContent.tsx:186-223`) and tool-call
result URLs — **out of scope**; they keep their current behavior
(`openExternalUrl`). Tool-card URLs get a follow-up pass.

## Fetch strategy

`src/lib/file-fetcher.ts`:

```ts
export async function fetchPreviewContent(
  url: string,
  kind: "md" | "text" | "code"
): Promise<{ content: string; mime: string }>;
```

- Uses `createFetcher()` from `src/lib/tauri-fetch.ts` (already Tauri-safe).
- For `image` / `html` kinds, no in-app fetch — the `<img>` / `<iframe>`
  tag fetches directly with the browser's native handling.
- 5 MB cap on text responses (check `Content-Length` if present, else
  read with a streaming guard; over cap → throw with a friendly message).
- Errors propagate as `{ code: 'cors' | 'notfound' | 'toobig' | 'network', message }`.
- Non-UTF-8 responses: fall back to latin1 decode rather than throwing
  (some plain text logs are not UTF-8).

## UI

`src/components/chat/FilePreviewPanel.tsx`:

```
┌─ FilePreviewPanel ───────────────────────────────────────┐
│ [📄 notes.md ×] [🖼  chart.png ×] [+]    [× close panel] │
│ ─────────────────────────────────────────────────────────│
│                                                        │
│   md     → <Markdown>{content}</Markdown>              │
│   text   → <pre className="font-mono ...">{content}</pre> │
│   code   → <CodeBlock language={lang}>{content}</CodeBlock> │
│   image  → <img src={url} className="object-contain" /> │
│   html   → <iframe src={url} sandbox="" />            │
│                                                        │
│   loading → centered spinner + "加载中…"               │
│   error   → red banner + [在浏览器中打开] [复制 URL]    │
│   empty   → "点击聊天里的 .md / 图片 / 代码链接预览"   │
└────────────────────────────────────────────────────────┘
```

- Default width 480 px, drag-resizable via existing
  `src/components/common/useColumnResize.ts` (same primitive the main
  sidebar uses). Persisted in `settings-store` next to `sidebarWidth`.
- Tab overflow: horizontal scroll, no wrap.
- Close button (×) on every tab; middle-click also closes.
- "Open in browser" button on error / empty always uses `openExternalUrl`.
- `kind` icon: `FileText` for md/text, `FileCode` for code, `Image` for
  image, `Globe` for html (lucide-react).

**Layout integration** (ChatPage):

- New column between chat and `InstancesPanel`.
- `filePreviewPanelOpen || filePreviewTabs.length > 0` → render panel.
- Existing `instancesPanelOpen` behavior unchanged.

## Testing

- `tests/preview-kind.test.ts` — extension map coverage, query/fragment
  stripping, case-insensitivity, unknown → null, edge URLs.
- `tests/file-fetcher.test.ts` — 5 MB cap enforced, error code mapping,
  latin1 fallback, mime inference from extension.
- `tests/ui-store-file-preview.test.ts` — `previewFile` reuses tab on
  duplicate URL, scopes by sessionId, `closeFileTab` keeps others,
  `setTabLoaded` flips state, panel toggle is independent of tabs.

UI components themselves are smoke-tested manually (screenshots in PR
description; per project convention `tests/` mirrors `src/lib/`, not
components).

## Docs

- `CHANGELOG.md` — add to `## Unreleased` → `### Added`, with
  `src/components/chat/FilePreviewPanel.tsx:<line>` references.
- `docs/design.md` — add short "文件预览侧栏" subsection under Stores /
  UI architecture with the data-flow diagram.

## Risks / known limitations

- **Browser + AGNO-instance URL** → CORS failure shows a clear error in
  the tab. Documented; v1 doesn't proxy. Tauri users are unaffected.
- **5 MB cap** is generous for md/text/code but not configurable in v1.
  Most agent-returned files are well under this; raise if users complain.
- **Tabs in memory only** — closing the app clears them. Acceptable v1;
  cross-restart persistence is a follow-up.
- **html sandbox** — `sandbox=""` allows nothing (no scripts, no forms,
  no top-nav, no same-origin). Safe default; some sites may not render
  properly inside (intentional).