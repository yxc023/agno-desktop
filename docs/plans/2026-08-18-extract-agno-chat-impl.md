# Extract agno-chat Component Package — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the chat UI + AGNO client + chat runner from `agno-desktop` into a workspace package `agno-chat` (`packages/agno-chat/`), so other frontends can drop in `<ChatPanel baseUrl agentId />` and get a full AGNO chat experience. App layer keeps only multi-instance management, routing, settings, updater, and Tauri shell.

**Architecture:** Bun workspace monorepo with `packages/agno-chat/` (vite lib mode build, peer dep on react). Tailwind v4 stays in the app layer; the sub-package ships source CSS with `@source` directives so the app's Tailwind compiler picks up the package's classes. Store refactor splits "context (client + agentId)" from "data (messages + sessions)" — context is injected by `<ChatPanel>` at mount, data flows through internal selectors never exposed externally. Switching AGNO instances is handled by `<ChatPanel key={...}>` remount at the app layer.

**Tech Stack:** React 19 + TypeScript 6 + Vite 8 (lib mode) + Tailwind CSS 4 (CSS-first) + Zustand 5 + Radix UI + react-markdown / remark-gfm / remark-breaks / rehype-highlight + bun:test + oxlint.

**Design reference:** `docs/plans/2026-08-18-extract-agno-chat.md`

---

## Phase 0 — Workspace Skeleton

### Task 1: Add workspace declaration to root package.json

**Files:**
- Modify: `package.json` (root)

**Step 1: Add workspaces field**

Edit `package.json` to add `"workspaces": ["packages/*"]` and add a top-level `test:chat` script. Read the file first to find the right insertion point.

Expected structure (key edits):

```json
{
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "oxlint",
    "typecheck": "tsc -b --noEmit",
    "test": "bun run scripts/test.ts",
    "test:chat": "cd packages/agno-chat && bun test",
    "tauri": "tauri",
    "dev:desktop": "tauri dev",
    "build:desktop": "bun run scripts/build-desktop.ts"
  }
}
```

**Step 2: Verify bun picks up workspaces**

Run: `bun install`
Expected: exit 0, "239 packages installed" (no change in package count).

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(monorepo): add workspaces declaration"
```

---

### Task 2: Create sub-package skeleton

**Files:**
- Create: `packages/agno-chat/package.json`
- Create: `packages/agno-chat/tsconfig.json`
- Create: `packages/agno-chat/vite.config.ts`
- Create: `packages/agno-chat/src/index.ts` (empty stub)

**Step 1: Write `packages/agno-chat/package.json`**

```json
{
  "name": "agno-chat",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./styles.css": "./src/styles.css"
  },
  "files": ["dist", "src/styles.css", "README.md"],
  "scripts": {
    "dev": "vite build --watch --mode development",
    "build": "tsc -b --noEmit && vite build",
    "typecheck": "tsc -b --noEmit",
    "lint": "cd ../.. && oxlint packages/agno-chat/src",
    "test": "bun test"
  },
  "peerDependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  }
}
```

**Step 2: Write `packages/agno-chat/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "jsx": "react-jsx",
    "lib": ["DOM", "DOM.Iterable", "ES2023"],
    "types": []
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "tests"]
}
```

**Step 3: Write `packages/agno-chat/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: [
        "react", "react-dom", "zustand",
        "react-markdown", "remark-gfm", "remark-breaks",
        "rehype-highlight", "rehype-raw", "highlight.js",
        "@tanstack/react-virtual", "react-resizable-panels",
        "lucide-react", "class-variance-authority", "clsx", "tailwind-merge",
        "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu",
        "@radix-ui/react-label", "@radix-ui/react-popover",
        "@radix-ui/react-scroll-area", "@radix-ui/react-select",
        "@radix-ui/react-separator", "@radix-ui/react-slot",
        "@radix-ui/react-switch", "@radix-ui/react-tabs",
        "@radix-ui/react-toast", "@radix-ui/react-tooltip",
      ],
      output: { dir: "dist", sourcemap: true },
    },
    sourcemap: true,
    target: "es2022",
  },
});
```

**Step 4: Write `packages/agno-chat/src/index.ts` (placeholder)**

```ts
export const AGN_O_CHAT_VERSION = "0.0.0";
```

**Step 5: Install the new package**

Run: `bun install`
Expected: agno-chat appears as a workspace package.

**Step 6: Verify typecheck still passes**

Run: `bun run typecheck`
Expected: exit 0 (root + sub-package).

**Step 7: Commit**

```bash
git add packages/agno-chat/
git commit -m "chore(monorepo): scaffold packages/agno-chat workspace package"
```

---

### Task 3: Wire up Tailwind source + alias for sub-package

**Files:**
- Modify: `src/index.css`
- Modify: `vite.config.ts`

**Step 1: Add `@source` directive to app Tailwind entry**

Edit `src/index.css` — find the `@import "tailwindcss";` line and add a `@source` directive right after it:

```css
@import "tailwindcss";
@source "../packages/agno-chat/src/**/*.{ts,tsx}";
```

(Keep all existing CSS variables and @theme blocks intact.)

**Step 2: Add alias for `agno-chat` → sub-package source**

Edit `vite.config.ts` to add a resolve alias:

```ts
import { fileURLToPath } from "node:url";
// ... in defineConfig:
resolve: {
  alias: {
    "agno-chat": fileURLToPath(
      new URL("./packages/agno-chat/src/index.ts", import.meta.url)
    ),
  },
},
optimizeDeps: { exclude: ["agno-chat"] },
```

Read the current `vite.config.ts` first to see where to splice.

**Step 3: Verify dev server still starts**

Run: `bun run dev` (then Ctrl-C after a few seconds)
Expected: vite starts on :5173, no errors.

**Step 4: Commit**

```bash
git add src/index.css vite.config.ts
git commit -m "chore(monorepo): wire tailwind source + alias for agno-chat"
```

---

## Phase 1 — Move Pure-Logic Libs

### Task 4: Copy pure logic libs into sub-package

**Files:**
- Create: `packages/agno-chat/src/lib/{sse-parser,chat-runner,message-types,message-types-helpers,chat-buffer,paced-value,auto-scroll-controller,agent-name,preview-kind,model-context-windows,estimate-tokens,strip-think-tags,highlight-client,highlight.worker,ime-composing,message-verbosity,tool-render-utils,agno-types,agno-client,utils}.ts`

For each file:
1. Copy from `src/lib/<name>.ts` to `packages/agno-chat/src/lib/<name>.ts`
2. Files that contain only AGNO-agnostic logic keep their content unchanged.
3. Files that import from `@/lib/...` need to be rewritten to import from `./...` (relative) within the package.

**Files that need import-path fixes** (after copy, search and replace):
- Anything importing `@/lib/utils` → `./utils`
- Anything importing `@/lib/storage` → **REMOVE** (storage is app-layer only; replace `loadJSON/saveJSON` calls with direct localStorage if needed, or refactor to use `zustand/persist` later)

**Step 1: List the files to move**

```bash
ls src/lib/*.ts
```

The list is: `agent-name.ts`, `agno-client.ts`, `agno-types.ts`, `auto-scroll-controller.ts`, `chat-buffer.ts`, `chat-runner.ts`, `estimate-tokens.ts`, `file-fetcher.ts` (STAYS in app), `highlight-client.ts`, `highlight.worker.ts`, `ime-composing.ts`, `message-types-helpers.ts`, `message-types.ts`, `message-verbosity.ts`, `model-context-windows.ts`, `open-external-url.ts` (STAYS), `paced-value.ts`, `preview-kind.ts`, `sse-parser.ts`, `storage.ts` (STAYS), `strip-think-tags.ts`, `tauri-fetch.ts` (STAYS), `tauri.ts` (STAYS), `timeline-cache.ts`, `tool-render-utils.ts`, `updater.ts` (STAYS), `user-id.ts` (STAYS), `utils.ts`.

**Step 2: Bulk copy with rewrite**

```bash
for f in agent-name agno-client agno-types auto-scroll-controller chat-buffer \
         chat-runner estimate-tokens highlight-client highlight.worker \
         ime-composing message-types message-types-helpers message-verbosity \
         model-context-windows paced-value preview-kind sse-parser \
         strip-think-tags timeline-cache tool-render-utils utils; do
  mkdir -p packages/agno-chat/src/lib
  cp src/lib/$f.ts packages/agno-chat/src/lib/$f.ts
done
```

**Step 3: Rewrite imports inside copied files**

For each copied file, search for `@/lib/` and rewrite to relative `./`. Common patterns:

- `@/lib/utils` → `./utils`
- `@/lib/agno-types` → `./agno-types`
- etc.

Use ripgrep to find remaining `@/lib/` references after copy:

```bash
rg "from ['\"]@/lib/" packages/agno-chat/src/lib/
```

Each match must be rewritten. Some files may also import from `@/lib/storage` (these are problematic — storage stays in app). For those, search for `loadJSON|saveJSON` and remove the imports + inline `JSON.parse(localStorage.getItem(...))` if needed. Note: most pure logic files don't use storage.

**Step 4: Verify sub-package typechecks**

Run: `bun run --filter agno-chat typecheck`
Expected: exit 0 (some warnings OK if `@types/node` is missing — add `"types": ["node"]` to sub-package tsconfig if so).

**Step 5: Commit**

```bash
git add packages/agno-chat/src/lib/
git commit -m "refactor(chat): move pure logic libs into agno-chat package"
```

---

### Task 5: Move corresponding tests into sub-package

**Files:**
- Create: `packages/agno-chat/tests/lib/{sse-parser,chat-runner,chat-buffer,paced-value,tool-render-utils,strip-think-tags,preview-kind,auto-scroll-controller,agent-name,model-context-windows,utils}.test.ts`
- Delete (later): originals in `tests/`

**Step 1: Inventory tests**

```bash
ls tests/*.test.ts
```

Tests to move (those whose subject moved in Task 4): sse-parser, chat-runner, chat-buffer, paced-value, tool-render-utils, strip-think-tags, preview-kind, auto-scroll-controller, agent-name, model-context-windows, utils, message-types-helpers (if it has tests), highlight-client (if it has tests), timeline-cache (if it has tests).

Tests that **stay** in app: anything referencing `useInstancesStore`, `tauri`, `updater`, `settings-store`, `instances-store`, `ui-store`, `sessions-store` (until Task 14).

**Step 2: Copy and rewrite imports**

For each test file, copy to `packages/agno-chat/tests/lib/` and rewrite `@/lib/` imports to relative `./` (or `../../src/lib/`).

**Step 3: Add sub-package tsconfig for tests**

Create `packages/agno-chat/tsconfig.test.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "jsx": "react-jsx",
    "lib": ["DOM", "DOM.Iterable", "ES2023"],
    "types": ["bun-types"]
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

Add `tsconfig.json` references:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": { /* same as Task 4 */ },
  "include": ["src/**/*"],
  "exclude": ["dist", "tests"],
  "references": [{ "path": "./tsconfig.test.json" }]
}
```

**Step 4: Run sub-package tests**

Run: `bun run --filter agno-chat test`
Expected: all moved tests pass.

**Step 5: Verify app-level tests still pass**

Run: `bun run test`
Expected: app-level tests pass (unchanged, since originals still exist).

**Step 6: Commit**

```bash
git add packages/agno-chat/tests/ packages/agno-chat/tsconfig.json packages/agno-chat/tsconfig.test.json
git commit -m "test(chat): move pure-logic tests into agno-chat package"
```

---

## Phase 2 — Move Components

### Task 6: Move markdown components

**Files:**
- Create: `packages/agno-chat/src/markdown/{Markdown,CodeBlock,MarkdownStream,markdown-stream}.{tsx,ts}`
- Modify: app-level files using markdown (later in Phase 4: ChatPanel)

**Step 1: Copy markdown components**

```bash
mkdir -p packages/agno-chat/src/markdown
cp src/components/markdown/*.tsx packages/agno-chat/src/markdown/
cp src/components/markdown/*.ts packages/agno-chat/src/markdown/
```

**Step 2: Rewrite imports**

```bash
rg "from ['\"]@/lib/" packages/agno-chat/src/markdown/
rg "from ['\"]@/components/" packages/agno-chat/src/markdown/
```

Rewrite to relative paths within the package:
- `@/lib/...` → `../lib/...`
- `@/components/ui/...` → `../ui/...`

**Step 3: Verify typecheck**

Run: `bun run typecheck`
Expected: exit 0 (both root and package).

**Step 4: Commit**

```bash
git add packages/agno-chat/src/markdown/
git commit -m "refactor(chat): move markdown components into agno-chat"
```

---

### Task 7: Move UI primitives into sub-package

**Files:**
- Create: `packages/agno-chat/src/ui/{button,dialog,dropdown-menu,input,label,popover,resizable,scroll-area,select,separator,skeleton,tabs,tooltip,badge}.tsx`
- Keep in app: `src/components/ui/{switch,card}.tsx`

**Step 1: Copy needed UI primitives**

```bash
for f in button dialog dropdown-menu input label popover resizable scroll-area \
         select separator skeleton tabs tooltip badge; do
  mkdir -p packages/agno-chat/src/ui
  cp src/components/ui/$f.tsx packages/agno-chat/src/ui/$f.tsx
done
```

**Step 2: Rewrite imports**

```bash
rg "from ['\"]@/lib/" packages/agno-chat/src/ui/
rg "from ['\"]@radix-ui/" packages/agno-chat/src/ui/
```

- `@/lib/utils` → `../lib/utils`
- `@radix-ui/...` stays (peer-dep)

**Step 3: Verify typecheck**

Run: `bun run typecheck`
Expected: exit 0.

**Step 4: Commit**

```bash
git add packages/agno-chat/src/ui/
git commit -m "refactor(chat): move UI primitives into agno-chat"
```

---

### Task 8: Move chat components

**Files:**
- Create: `packages/agno-chat/src/components/chat/{ChatPanel,MessageBubble,MessageContent,MessageInput,ToolCallCard,ToolCallGroup,ReasoningBlock,ApprovalDialog,VirtualMessageList,AgentPicker,ContextProgressBar,FilePreviewPanel,SubAgentSidePanel}.tsx`
- Modify (later): `src/pages/ChatPage.tsx`

**Step 1: Copy chat components**

```bash
mkdir -p packages/agno-chat/src/components/chat
cp src/components/chat/*.tsx packages/agno-chat/src/components/chat/
```

**Step 2: Rewrite imports**

```bash
rg "from ['\"]@/" packages/agno-chat/src/components/chat/
```

Rewrite systematically:
- `@/lib/...` → `../../lib/...`
- `@/components/markdown/...` → `../../markdown/...`
- `@/components/ui/...` → `../../ui/...`
- `@/components/sessions/...` → `../sessions/...`
- `@/stores/...` → `../../stores/...` (will be created in Phase 3)

**Step 3: Verify typecheck**

This will fail because `stores/` doesn't exist yet in the package. Expected outcome is typecheck failures pointing at missing store imports — that's fine, we address it in Phase 3. To verify the move didn't introduce *new* failures, run:

```bash
bun run typecheck 2>&1 | rg "error" | wc -l
```

Capture the baseline error count for comparison after Phase 3.

**Step 4: Commit**

```bash
git add packages/agno-chat/src/components/chat/
git commit -m "refactor(chat): move chat components into agno-chat (types broken until Phase 3)"
```

---

### Task 9: Move session list component

**Files:**
- Create: `packages/agno-chat/src/components/sessions/SessionList.tsx`
- Create: `packages/agno-chat/src/components/sessions/InstanceInfoStrip.tsx`

**Step 1: Copy**

```bash
mkdir -p packages/agno-chat/src/components/sessions
cp src/components/sessions/*.tsx packages/agno-chat/src/components/sessions/
```

**Step 2: Rewrite imports** (same pattern as Task 8)

```bash
rg "from ['\"]@/" packages/agno-chat/src/components/sessions/
```

**Step 3: Commit**

```bash
git add packages/agno-chat/src/components/sessions/
git commit -m "refactor(chat): move session list components into agno-chat"
```

---

### Task 10: Add sub-package public API stubs

**Files:**
- Modify: `packages/agno-chat/src/index.ts`

**Step 1: Add stub exports**

```ts
// packages/agno-chat/src/index.ts
export const AGNO_CHAT_VERSION = "0.0.0";

// Components (stubs — real implementations come in later tasks)
export { ChatPanel } from "./ChatPanel";
export type { ChatPanelProps } from "./types";

// Lib
export { AgnoClient } from "./lib/agno-client";
```

**Step 2: Create minimal types file**

Create `packages/agno-chat/src/types.ts`:

```ts
import type { ReactNode } from "react";

export interface ChatPanelProps {
  baseUrl: string;
  agentId?: string;
  agents?: AgentSummary[];
  onAgentsChange?: (agents: AgentSummary[]) => void;
  auth?: { token?: string; headers?: Record<string, string> };
  theme?: AgnoChatTheme;
  showSessionList?: boolean;
  showReasoning?: boolean;
  showContextProgress?: boolean;
  briefToolCalls?: boolean;
  onError?: (err: Error) => void;
  onSessionChange?: (sessionId: string | null) => void;
  slots?: ChatPanelSlots;
}

export interface AgnoChatTheme {
  accent?: string;
  accentFg?: string;
  radius?: string;
}

export interface ChatPanelSlots {
  header?: (ctx: { sessionName?: string }) => ReactNode;
  empty?: () => ReactNode;
  inputFooter?: () => ReactNode;
}

export interface AgentSummary {
  id: string;
  name?: string;
  description?: string;
}
```

**Step 3: Stub ChatPanel**

Create `packages/agno-chat/src/ChatPanel.tsx`:

```tsx
import type { ChatPanelProps } from "./types";

export function ChatPanel(_props: ChatPanelProps) {
  return null;
}
```

**Step 4: Verify typecheck**

Run: `bun run typecheck`
Expected: exit 0.

**Step 5: Commit**

```bash
git add packages/agno-chat/src/index.ts packages/agno-chat/src/types.ts packages/agno-chat/src/ChatPanel.tsx
git commit -m "feat(chat): add agno-chat public API stubs"
```

---

## Phase 3 — Store Refactor

### Task 11: Parameterize chat-store (step a: minimal copy)

**Files:**
- Create: `packages/agno-chat/src/stores/chat-store.ts`
- Modify: `src/stores/chat-store.ts` (replace with re-export shim)
- Delete: original `src/stores/chat-store.ts` content (eventually)

**Step 1: Copy chat-store verbatim**

```bash
mkdir -p packages/agno-chat/src/stores
cp src/stores/chat-store.ts packages/agno-chat/src/stores/chat-store.ts
```

**Step 2: Rewrite imports**

```bash
rg "from ['\"]@/lib/" packages/agno-chat/src/stores/chat-store.ts
```

- `@/lib/chat-runner` → `../lib/chat-runner`
- `@/lib/message-types` → `../lib/message-types`
- `@/lib/agent-name` → `../lib/agent-name`
- `@/lib/chat-buffer` → `../lib/chat-buffer`
- `@/lib/utils` → `../lib/utils`
- `@/lib/agno-types` → `../lib/agno-types`

**Step 3: Replace app shim**

Make `src/stores/chat-store.ts` re-export from package:

```ts
// src/stores/chat-store.ts (shim)
export * from "agno-chat";
```

But the package doesn't export chat-store yet — first add it.

**Step 4: Re-export from package**

Add to `packages/agno-chat/src/index.ts`:

```ts
// Re-export store internals so app shim works
export { useChatStore, buildToolResultIndex } from "./stores/chat-store";
```

(Keeping the export internal for now; will hide later.)

**Step 5: Verify typecheck and tests**

Run: `bun run typecheck && bun run test`
Expected: both pass.

**Step 6: Commit**

```bash
git add packages/agno-chat/src/stores/chat-store.ts packages/agno-chat/src/index.ts src/stores/chat-store.ts
git commit -m "refactor(chat): move chat-store into agno-chat (uses useInstancesStore still)"
```

---

### Task 12: Parameterize chat-store (step b: context injection)

**Files:**
- Modify: `packages/agno-chat/src/stores/chat-store.ts`
- Modify: `packages/agno-chat/src/ChatPanel.tsx`
- Modify: `packages/agno-chat/src/index.ts`

**Step 1: Identify all `useInstancesStore` callsites**

```bash
rg "useInstancesStore" packages/agno-chat/src/stores/chat-store.ts
```

The callsites are:
- `loadHistory` — reads `activeInstanceId`, `getClient`
- `sendMessage` — same

**Step 2: Add context fields and setter to store**

Add to `ChatState`:

```ts
_client: AgnoClient | null;
_agentId: string | null;
_userId: string; // for session/user isolation

setContext: (ctx: { client: AgnoClient; agentId: string; userId?: string }) => void;
clearContext: () => void;
```

Initial values: `_client: null`, `_agentId: null`, `_userId: ""`.

Implement setters:

```ts
setContext: (ctx) => set({
  _client: ctx.client,
  _agentId: ctx.agentId,
  _userId: ctx.userId ?? "",
}),
clearContext: () => set({
  _client: null,
  _agentId: null,
  _userId: "",
}),
```

**Step 3: Replace `useInstancesStore` callsites with `_client` / `_agentId`**

In `loadHistory` and `sendMessage`, replace:

```ts
const client = useInstancesStore.getState().getClient(activeId);
```

with:

```ts
const client = get()._client;
if (!client) return;
```

And replace `activeInstanceId` reads with `get()._agentId` for the agent-scoping bits, or drop entirely if the package no longer cares about multi-instance.

**Step 4: Mount ChatPanel calls setContext at mount**

In `packages/agno-chat/src/ChatPanel.tsx`:

```tsx
import { useEffect, useMemo } from "react";
import { AgnoClient } from "./lib/agno-client";
import { useChatStore } from "./stores/chat-store";
import type { ChatPanelProps } from "./types";

export function ChatPanel({ baseUrl, auth, agentId, agents }: ChatPanelProps) {
  const client = useMemo(
    () => new AgnoClient({ baseUrl, token: auth?.token, headers: auth?.headers }),
    [baseUrl, auth?.token]
  );

  useEffect(() => {
    if (!agentId) return;
    useChatStore.getState().setContext({ client, agentId });
    return () => {
      useChatStore.getState().clearContext();
    };
  }, [client, agentId]);

  return <div data-agno-chat-agent={agentId}>{/* full chat UI later */}</div>;
}
```

**Step 5: Hide store from public exports**

Remove `useChatStore` and `buildToolResultIndex` from `packages/agno-chat/src/index.ts`. The app still imports them via shim.

**Step 6: Verify typecheck and tests**

Run: `bun run typecheck && bun run test`
Expected: both pass. App-level chat-store tests should still pass via shim.

**Step 7: Commit**

```bash
git add packages/agno-chat/src/stores/chat-store.ts packages/agno-chat/src/ChatPanel.tsx packages/agno-chat/src/index.ts src/stores/chat-store.ts
git commit -m "refactor(chat): parameterize chat-store with injected context"
```

---

### Task 13: Move + parameterize sessions-store

**Files:**
- Create: `packages/agno-chat/src/stores/sessions-store.ts`
- Modify: `src/stores/sessions-store.ts` (shim)

**Step 1: Copy sessions-store**

```bash
cp src/stores/sessions-store.ts packages/agno-chat/src/stores/sessions-store.ts
```

**Step 2: Rewrite imports + parameterize**

- `@/lib/...` → `../lib/...`
- `useInstancesStore` callsites → use `useChatStore.getState()._client` (which the chat-store now exposes via context injection)
- `byInstance` → rename to `byAgent`

**Step 3: Add store re-export to package**

```ts
// packages/agno-chat/src/index.ts (internal)
export { useSessionsStore } from "./stores/sessions-store";
```

**Step 4: Replace app shim**

```ts
// src/stores/sessions-store.ts
export * from "agno-chat";
```

**Step 5: Verify**

Run: `bun run typecheck && bun run test`
Expected: both pass.

**Step 6: Commit**

```bash
git add packages/agno-chat/src/stores/sessions-store.ts packages/agno-chat/src/index.ts src/stores/sessions-store.ts
git commit -m "refactor(chat): move + parameterize sessions-store"
```

---

### Task 14: Verify multi-instance switching manually

**Files:** none (manual test)

**Step 1: Build dev**

Run: `bun run dev`

**Step 2: Test scenarios**

- Add 2 AGNO instances, switch between them. Verify:
  - Chat state resets per instance.
  - Sessions per instance load correctly.
  - Send a message in instance A → switch to B → switch back to A → message still there.
- Test SSE streaming interruption when switching mid-stream.
- Test agent switching (same instance, different agent): clear messages, fresh load.

**Step 3: Capture findings**

Note any rough edges in `docs/plans/2026-08-18-extract-agno-chat.md` follow-up section (or a separate note). Do not commit findings unless they're code changes.

---

## Phase 4 — Simplify ChatPage

### Task 15: Replace ChatPage with thin wrapper

**Files:**
- Modify: `src/pages/ChatPage.tsx`

**Step 1: Read current ChatPage**

Read `src/pages/ChatPage.tsx` to understand the structure (AgentPicker wiring, layout slots, etc.).

**Step 2: Rewrite as thin wrapper**

The new ChatPage should:

```tsx
import { ChatPanel } from "agno-chat";
import { useActiveInstance } from "@/stores/instances-store";
import { useActiveAgents } from "@/stores/instances-store";

export function ChatPage() {
  const active = useActiveInstance();
  const agents = useActiveAgents();

  if (!active) return <WelcomeScreen />;

  return (
    <ChatPanel
      baseUrl={active.baseUrl}
      auth={{ token: active.token ?? undefined }}
      agents={agents}
      // existing settings wired via slots
      slots={{ /* from app settings */ }}
    />
  );
}
```

**Step 3: Remove now-unused imports**

After the rewrite, remove unused imports from ChatPage. The new file should be ~80 lines.

**Step 4: Verify typecheck and dev**

Run: `bun run typecheck && bun run dev`
Expected: dev server starts; chat UI renders correctly when an instance is selected.

**Step 5: Manual UI smoke test**

- Verify empty state shows.
- Verify listSessions loads.
- Verify listAgents loads (selectable agents).
- Send a message — verify SSE stream works.
- Verify HITL approval flow works.
- Verify sub-agent side panel.

**Step 6: Commit**

```bash
git add src/pages/ChatPage.tsx
git commit -m "refactor(chat): simplify ChatPage to thin ChatPanel wrapper"
```

---

## Phase 5 — Cleanup

### Task 16: Drop now-unused deps from app package.json

**Files:**
- Modify: `package.json` (root)

**Step 1: Identify removable deps**

These should now come transitively via `agno-chat`:

- `@radix-ui/react-dialog`, `react-dropdown-menu`, `react-label`, `react-popover`, `react-scroll-area`, `react-select`, `react-separator`, `react-slot`, `react-toast`, `react-tooltip`
- `react-markdown`, `remark-gfm`, `remark-breaks`, `rehype-highlight`, `rehype-raw`
- `highlight.js`
- `@tanstack/react-virtual`
- `react-resizable-panels`
- `zustand`
- `lucide-react`
- `class-variance-authority`, `clsx`, `tailwind-merge`
- `sonner` (only if app doesn't use it directly outside chat — check imports)

**Keep** in app: `@radix-ui/react-switch`, `@radix-ui/react-tabs` (settings page uses tabs directly).

**Step 2: Verify each removed dep is unused in app**

```bash
rg "from ['\"]lucide-react['\"]" src/ | grep -v packages/agno-chat
```

If any match outside the package, keep the dep.

**Step 3: Remove from package.json**

Delete each unused dep from `dependencies` in root `package.json`.

**Step 4: bun install**

Run: `bun install`
Expected: exit 0; lockfile updates.

**Step 5: Verify typecheck + build**

Run: `bun run typecheck && bun run build`
Expected: both pass.

**Step 6: Verify dev**

Run: `bun run dev`
Expected: app starts; chat works; everything still renders.

**Step 7: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(monorepo): drop chat-related deps from app, now provided by agno-chat"
```

---

### Task 17: Add sub-package README

**Files:**
- Create: `packages/agno-chat/README.md`

**Step 1: Write consumer-facing docs**

```markdown
# agno-chat

React component package for embedding AGNO AgentOS chat into any web/desktop app.

## Quick start

\`\`\`tsx
import { ChatPanel } from "agno-chat";
import "agno-chat/styles.css";

function App() {
  return (
    <ChatPanel
      baseUrl="http://127.0.0.1:8000"
      auth={{ token: "Bearer xxx" }}
      agentId="my-agent"
      onError={(err) => console.error(err)}
    />
  );
}
\`\`\`

## Props

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `baseUrl` | `string` | yes | — | AGNO server URL |
| `agentId` | `string` | one of | — | Active agent ID |
| `agents` | `AgentSummary[]` | one of | — | Static agent list (skips listAgents) |
| `auth` | `{ token?, headers? }` | no | — | Authentication |
| `theme` | `AgnoChatTheme` | no | — | CSS variable overrides |
| `showSessionList` | `boolean` | no | `true` | Show left sidebar |
| `showReasoning` | `boolean` | no | `true` | Show reasoning blocks |
| `showContextProgress` | `boolean` | no | `true` | Show context-window ring |
| `briefToolCalls` | `boolean` | no | `false` | Collapse tool calls |
| `onError` | `(err: Error) => void` | no | — | Error callback |
| `onSessionChange` | `(id: string \| null) => void` | no | — | Session change callback |
| `slots` | `ChatPanelSlots` | no | — | Sub-area overrides |

## Theming

Override CSS variables on `:root` or pass via `theme` prop:

\`\`\`css
:root {
  --agno-accent: #7c3aed;
  --agno-accent-fg: white;
  --agno-radius: 0.625rem;
}
\`\`\`

## Peer dependencies

- `react ^19.2.0`
- `react-dom ^19.2.0`

Tailwind v4 is **not** required — the package ships source CSS with `@source` directives so your Tailwind compiler picks up classes automatically.

## Advanced: sub-area overrides

\`\`\`tsx
<ChatPanel
  baseUrl="..."
  agentId="..."
  slots={{
    header: ({ sessionName }) => <MyHeader name={sessionName} />,
    empty: () => <MyEmptyState />,
  }}
/>
\`\`\`

## License

Same as agno-desktop (see root repo).
\`\`\`

**Step 2: Commit**

```bash
git add packages/agno-chat/README.md
git commit -m "docs(chat): add agno-chat README"
```

---

### Task 18: Update AGENTS.md + docs/design.md

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/design.md`

**Step 1: Add sub-package section to AGENTS.md**

Add after the "Project layout" section:

```markdown
## Subpackage: agno-chat

Lives at `packages/agno-chat/`. Workspace package; published-style API surface
(`<ChatPanel>` + types). Tailwind v4 CSS is shipped as source with `@source`
directives so the app's Tailwind compiler picks up classes automatically.

When working on chat internals, edit files in `packages/agno-chat/src/` — the
app's vite config aliases `agno-chat` → that source for HMR.

When extending the public API, edit `packages/agno-chat/src/index.ts` and
`types.ts`. Internal stores (chat-store, sessions-store) are NOT exported —
reaching into them from the app is a refactor smell.
```

**Step 2: Update docs/design.md**

Add a new section after "Stores" describing the monorepo split.

**Step 3: Commit**

```bash
git add AGENTS.md docs/design.md
git commit -m "docs: document agno-chat subpackage"
```

---

### Task 19: Add CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add v0.0.13 entry**

Insert at top (after `## Unreleased` if it exists, otherwise above `[0.0.12]`):

```markdown
## [0.0.13] - 2026-08-18

### Added
- **New workspace package `agno-chat`** (`packages/agno-chat/`) — exposes `<ChatPanel>` for embedding AGNO AgentOS chat into any React 19 app. Drops in via `import { ChatPanel } from "agno-chat"` plus `import "agno-chat/styles.css"`. Internally owns the AGNO client, chat runner, SSE parser, session management, message store, and all chat-related UI components. Themeable via CSS variables (`--agno-accent`, `--agno-radius`, etc.). Single React 19 instance (peer dep), single Tailwind v4 compiler (CSS source scanning).

### Changed
- **Monorepo restructure.** Root `package.json` now declares `"workspaces": ["packages/*"]`. The chat surface moves out of `src/` into `packages/agno-chat/src/`. App layer keeps only multi-instance management, routing, settings, updater, Tauri shell. `<ChatPanel key={`${instId}-${agentId}`}>` is the app's switch mechanism for AGNO instances — switching instance remounts the panel, dropping state cleanly.
- **App `package.json` slimmed.** Removed ~17 deps now provided transitively via `agno-chat` (Radix UI primitives, react-markdown, highlight.js, zustand, react-resizable-panels, @tanstack/react-virtual, lucide-react, class-variance-authority, clsx, tailwind-merge). Single React + single Tailwind compiler eliminates double-bundle risk.
- **ChatPage simplified.** `src/pages/ChatPage.tsx` is now a thin wrapper that reads active instance + agent list from `instances-store` and renders `<ChatPanel>`. Most of the previous ~500 lines moved into the sub-package's internal `<ChatPanel>` implementation.

### Notes
- Internal chat-store and sessions-store no longer reference `useInstancesStore`. They're now parameterized via injected `client` / `agentId` context set at `<ChatPanel>` mount and cleared on unmount. Stores are NOT part of the public API.
```

**Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): add 0.0.13 entry for agno-chat extraction"
```

---

### Task 20: Final verification

**Files:** none

**Step 1: Full clean build**

Run: `bun install && bun run typecheck && bun run lint && bun run test && bun run build`
Expected: all pass.

**Step 2: Dev verification**

Run: `bun run dev`
Manual check: chat works end-to-end (send message, SSE stream, tool call, HITL, sub-agent).

**Step 3: Tauri build smoke test (optional, slow)**

Run: `bun run build:desktop`
Expected: produces `src-tauri/target/release/bundle/...`

**Step 4: Verify file counts**

```bash
echo "App src/lib lines:"; wc -l src/lib/*.ts | tail -1
echo "App src/components lines:"; wc -l src/components/**/*.tsx | tail -1
echo "Package lines:"; find packages/agno-chat/src -name '*.ts' -o -name '*.tsx' | xargs wc -l | tail -1
```

Verify the move happened (app shrank by ~5-8k lines, package grew by similar amount).

**Step 5: Final commit if any uncommitted tweaks**

```bash
git status
# If anything outstanding:
git add -A
git commit -m "chore: final cleanup after agno-chat extraction"
```

---

## Done Criteria

- `bun run typecheck` exits 0
- `bun run lint` exits 0
- `bun run test` passes (all tests, app + package)
- `bun run build` exits 0
- `bun run dev` shows a working chat UI
- App `src/pages/ChatPage.tsx` is <100 lines
- `packages/agno-chat/src/index.ts` exports `<ChatPanel>`, types, `AgnoClient`
- App `package.json` has the deps reduced
- CHANGELOG.md has v0.0.13 entry
- Design doc + impl plan are in `docs/plans/`

Total tasks: 20. Each task is 5-30 minutes. Total estimate: 4-8 hours.