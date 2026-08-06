# Changelog

All notable changes to Agno Desktop are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added
- **Static-file links inside chat now open in an in-app preview panel instead of jumping to the system browser.** Markdown links whose URL ends with a previewable extension (`.md`/`.markdown`/`.txt`/`.log`, common images, `.html`/`.htm`, `.json`/`.yaml`/`.csv`/`.xml`/`.toml` and common source extensions) are intercepted at click time (`src/components/markdown/Markdown.tsx:105`); everything else still goes through `openExternalUrl`. The panel lives to the right of the chat (`src/pages/ChatPage.tsx`), supports multiple tabs, persists per session (closing the panel hides UI but keeps tabs in memory; switching sessions restores the previous session's tabs), and renders content by kind: Markdown via the existing `Markdown` component, plain text as monospace `<pre>`, code/structured data via `CodeBlock` with worker-driven highlighting, images via `<img>`, and HTML via a fully sandboxed `<iframe>`. Width is drag-resizable (320-720px range), persisted as `settings.filePreviewWidth`. Error and empty states include fallback buttons (`在浏览器中打开` / `复制 URL`) so a CORS-blocked AGNO-instance URL still has an escape hatch.
- **Always-visible title-bar toggle for the preview panel** (`src/components/layout/AppTitleBar.tsx`). Sits at the right edge of the macOS-style title bar (next to update status), uses `PanelRightOpen` / `PanelRightClose` icons, and renders an accent dot when the active session has open tabs. Only active on the `/chat` route with an instance selected; on other routes the button is disabled with a tooltip explaining why, so the entry point never disappears.

### Changed
- **Chat header slimmed down — agent / instance / user info moved out of the cramped 12-column row.** The middle column's chat header (`src/components/chat/ChatPanel.tsx`) now only carries the context-window progress ring, streaming indicator, and `new` button. Three new placements:
  - **Agent picker** lives in `MessageInput`'s bottom row, sharing the line with `user_id` (agent on the left, user_id on the right) — see `src/components/chat/AgentPicker.tsx`. When the active session already has an `agent_id` (i.e. opening any pre-existing session from the sidebar), it collapses to a locked badge with a `Lock` icon — agent cannot be switched mid-session, since runs/memory are tied to it. When no session is active (empty state) or a fresh session is being created, it shows the full agent `Select` dropdown plus a refresh button (probe + loadAgents).
  - **Instance info** moved to the top of the left sessions sidebar via `InstanceInfoStrip` (`src/components/sessions/InstanceInfoStrip.tsx`): instance name, base URL, and a colored probe-status dot (success / error / loading). The 200-360px-wide sessions column has plenty of horizontal room that the cramped chat header didn't.
  - **user_id display** removed from the header (already shown inside `MessageInput` near the textarea, on the same row as the agent picker now).
- **MessageInput row has min-width 480 px so it stops shrinking gracefully.** The wrapper is now `w-full min-w-[480px]` (`src/components/chat/MessageInput.tsx`); when the chat column drops below 480 px the row overflows the column (clipped by `main`'s `overflow-hidden` in `AppShell`) instead of squeezing the textarea below the send button's width. Internal flex items all carry `min-w-0` so long agent names / user_ids truncate rather than push siblings off-screen.
- **Removed redundant key-hint copy.** `MessageInput`'s `placeholder` no longer carries `(Enter 发送, Shift+Enter 换行)` and the bottom row no longer renders `Enter 发送 · Shift+Enter 换行` — both were already implied by the textarea affordance and the visible Send button.
- **Relative / custom-scheme URLs from agents now resolve against the active instance.** AGNO emits occasionally returns resource URLs as `file_path:requirements/foo.md`, `//requirements/foo.md`, or `/requirements/foo.md` instead of a full `https://…`. Previously `new URL("//foo")` threw and the click did nothing. `resolvePreviewUrl` (`src/lib/preview-kind.ts`) now normalises these against the active instance's `baseUrl` before the preview-vs-external split in `Markdown.tsx`'s `<a>` onClick — so a `file_path:requirements/foo.md` link in a session backed by `http://192.168.1.5:8000` lands the tab at `http://192.168.1.5:8000/requirements/foo.md`. Same resolution runs on the fallback path, so non-previewable relative URLs (`file_path:doc.pdf`) now also open correctly. Tauri uses full-URL baseUrls; browser dev mode typically uses `/api` (Vite proxy) — both handled. Tests cover all three prefix shapes × both baseUrl shapes × trailing-slash normalization.
- **Two new chat-verbosity settings** — Settings → 对话偏好 (`src/pages/SettingsPage.tsx`):
  - **隐藏思考过程** (`settings.hideReasoning`, default `false`). Filters out `reasoning` parts at the rendering layer (`src/components/chat/MessageContent.tsx`) before `partitionParts` sees them — so toggling the switch takes effect mid-stream without dropping data. Orthogonal to the existing `collapseReasoning` (which controls *default expand state*); with both on the block is simply absent. The toggle description calls out the layering: "关闭折叠也无法恢复".
  - **工具调用使用简略展示** (`settings.briefToolCalls`, default `false`). When on, the partition algorithm (`src/lib/message-verbosity.ts`) collapses *any* consecutive `tool_call` parts — not just read-like — into a single `ToolCallGroup` chip (`src/components/chat/ToolCallGroup.tsx`) showing count + tool-name histogram (`read_file×3 · shell×2 · web_search`) + total duration + an error badge if any of the N calls failed. Click to expand inline; copy-all still works on the group. The original read-like-only grouping (`groupConsecutiveReadCalls` in the old `MessageContent`) is preserved for non-brief mode so default behavior is unchanged. A single tool call between two text outputs still renders as a plain `ToolCallCard` — chipping only happens at ≥ 2.
  - Both settings apply to sub-agent side panels too (they reuse `MessageContent`).
- **Inline `<think>` / `<thinking>` / `<reasoning>` reasoning tags now stripped when reasoning is hidden.** Some models (DeepSeek-R1 / Qwen3 / QwQ / Yi / Hunyuan / Llama-Nemotron / various open-source) emit reasoning inline as `<think>...</think>` etc. directly in the model output. When AGNO doesn't parse these into the reasoning_content channel, the literal tag text leaks into `TextPart` and shows up as visible noise. `src/lib/strip-think-tags.ts` is a balanced-bracket stripper (not regex) that handles: paired blocks, multiline content, nesting (`<think>A<think>B</think>C</think>` correctly removes the whole outer pair), unclosed opens (`<think>foo` strips from there to end), orphan closes (`foo</think>bar` → `foobar`), and case-insensitive matching. `MessageContent`'s text branch applies it inside the existing `hideReasoning` toggle — same code path as the reasoning block filter, so toggling once covers both. The strip is render-layer only — chat history in `chat-store` is unchanged, so flipping the toggle back exposes the original text. Settings description updated to spell out which tag names are covered.

### Notes
- 3 new test files cover the foundation: `tests/preview-kind.test.ts` (URL → PreviewKind mapping incl. query/fragment stripping and case-insensitivity), `tests/file-fetcher.test.ts` (5 MB cap via both `Content-Length` and streaming guard, error code mapping for `cors` / `notfound` / `toobig` / `network`, latin1 fallback for non-UTF-8 bodies, MIME inference), `tests/ui-store-file-preview.test.ts` (panel toggle independence, tab reuse on duplicate URL, sessionId scoping, active-tab re-routing when closing the active tab). Plus `tests/message-verbosity.test.ts` (25 assertions: partition algorithm under both modes, text/reasoning breaks, scan-order preservation across groups, single-tool passthrough, empty/reasoning-only edge cases) and `tests/strip-think-tags.test.ts` (paired single/multi-line/empty, nested triple, unclosed open + orphan close, case variants per tag name, mixed tag types in one string, markdown/code-block content, idempotence, streaming partial mid-thinking). `tests/` total grew from 24 → 30 files.
- **Browser + AGNO-instance URL limitation**: when running in browser (not Tauri desktop), `http://127.0.0.1:8000/...` URLs that aren't routed through the existing `/api` Vite proxy will fail with a CORS error in the tab — same root cause as the rest of the AGNO integration. Tauri users (`tauri-plugin-http`) are unaffected. No new proxy added in v1; document + escape-hatch buttons instead. Out of scope: tool-call result URLs (`web_search` returns), PDFs, cross-restart persistence of open tabs.
- Design doc: `docs/plans/2026-08-06-file-preview-panel-design.md`.

## [0.0.11] - 2026-08-05

### Fixed
- **Chat scroll at boundary rubber-banded the whole page** — when the conversation got long enough to scroll, scrolling the wheel all the way to the top (or bottom) and then continuing caused the entire viewport to drag down (or up), leaving blank space at the top of the window. This was scroll chaining: the inner chat container (`src/components/chat/ChatPanel.tsx:418`) had `overflow-y-auto` with no `overscroll-behavior`, so wheel events that arrived at `scrollTop === 0` (or `scrollHeight`) propagated up to `html`/`body`, which had no `overflow: hidden` either. In Tauri WKWebView this surfaces as the macOS-style rubber-band pull on the whole window; in browsers it surfaces as the page scrolling under the chat. Two-layer fix: (1) global `overscroll-behavior: none` on `html, body, #root` (`src/index.css:32`) as the outermost safety net; (2) `overscroll-y-contain` on the chat scroll container (`src/components/chat/ChatPanel.tsx:418`), the right `InstancesPanel` aside (`src/pages/ChatPage.tsx:125`), the `SubAgentSidePanel` body (`src/components/chat/SubAgentSidePanel.tsx:98`), and the agent list inside `InstancesPanel` (`src/components/instances/InstancesPanel.tsx:133`) so each inner scroller swallows its own overscroll instead of bubbling it up.

### Documentation
- **README rewritten for v0.0.10 reality** — previous version was significantly out of date (project structure, tech stack, roadmap, known issues, auto-update pubkey section, bottom version line all stale). Adds a prominent `🍎 macOS 桌面端首次启动` section with the `xattr -dr com.apple.quarantine` workaround and two UI alternatives for the unsigned `.dmg` Gatekeeper block — this is the standard answer for every new macOS user until proper signing + notarization is set up. Then a follow-up pass trims architecture / implementation rationale (项目结构 / 技术栈 / 自动更新 工作原理 etc.) so the README stays focused on intro + usage; those details live in `docs/design.md` / `AGENTS.md` / `docs/api-mapping.md`.

## [0.0.10] - 2026-07-26

### Changed
- **`user_id` is now per-instance.** Previously a single global `userId` lived in `settings-store` and was shared by every AGNO instance — meaning your dev / staging / prod sessions all landed under the same identity on each backend. Now each `AgnoInstance` carries its own `userId: string` (`src/stores/instances-store.ts:23`); the legacy `settings.userId` / `userIdConfirmed` / `hasUserId` are removed from `settings-store`. The `InstanceFormDialog` makes `user_id` a required field at add / edit time (`src/components/instances/InstanceFormDialog.tsx:103`), and `UserIdSetupDialog` becomes a per-instance dialog (`src/components/common/UserIdSetupDialog.tsx`) — title now reads "设置该实例的 user_id" with the instance name attached, and saves go to `instancesStore.updateInstance(instanceId, { userId })` instead of global settings. `ChatPanel` / `MessageInput` / `MemoryPage` all read `active.userId`; `SettingsPage` drops its global editor and points users to the instance-edit path.
- **Session list is filtered by the active instance's `user_id`.** `sessions-store.loadSessions` / `loadMoreSessions` now pass `inst.userId` to `client.listSessions({ user_id, ... })` so the sidebar only shows the active identity's sessions (`src/stores/sessions-store.ts:95` / `:146`). Defense in depth: a client-side filter (`filterByUserId`) drops anything the server returns with a different `user_id` — older AGNO versions that don't strictly filter by `user_id` no longer leak other users' sessions into the list. Cache key is implicit: `sessionsUserId[instanceId]` tracks the `userId` the cache was populated under, so changing the instance's `userId` (in `InstanceFormDialog`) auto-invalidates on the next `loadSessions` — no explicit `clearSessionsCache` needed. A `clearSessionsCache(instanceId)` escape hatch is exposed for completeness.
- **`newSession` uses a local UUID placeholder.** AGNO accepts and reuses whatever `session_id` we pass in `POST /agents/{id}/runs`, so `crypto.randomUUID()` doubles as both the local message-store key and the server-side session id — `onRunStarted` no longer needs key migration logic, just `upsertSession` so the sidebar shows the new session during streaming (`src/stores/chat-store.ts:1729`).
- **`UserIdSetupDialog` no longer triggers on Enter inside the input.** Previously a Chinese IME committing pinyin via Enter would dismiss the dialog mid-IME and silently lose the user's intent. The handler is removed entirely — only the explicit 「保存」 button closes the dialog.

### Fixed
- **`userId` was never actually sent to AGNO.** `chat-store.sendMessage` had `userId: null` hardcoded (`src/stores/chat-store.ts:1867`), and `continueRun` had the same (`src/stores/chat-store.ts:1958`). Even with the global setup dialog forcing the user to type a value, every `POST /agents/{id}/runs` request hit the backend with `user_id: null` — so AGNO's per-user memory / session scoping silently fell back to anonymous. The new per-instance code resolves `active.userId` at send-time and passes it to `runner.run({ userId: effectiveUserId })` (`src/stores/chat-store.ts:1729`); the runner forwards it as `user_id` in `POST /agents/{id}/runs` formdata (`src/lib/chat-runner.ts:134`) and `POST /agents/{id}/runs/{run}/continue` formdata (`src/lib/chat-runner.ts:243`). After upgrading, existing instances load with `userId === ""` and the per-instance setup dialog fires once on first chat — fill it and you're live.
- **Browser spellcheck marked every user_id as a typo.** Even for valid identifiers like `mike.dev`, Chrome / Safari drew red squiggles under the input while the user was typing — distracting and suggesting the value was wrong. Both `UserIdSetupDialog` and `InstanceFormDialog` inputs now declare `spellCheck={false}` + `autoCorrect="off"` + `autoCapitalize="off"` (`src/components/common/UserIdSetupDialog.tsx`, `src/components/instances/InstanceFormDialog.tsx`) so the browser leaves identifiers alone.
- **`onRunStarted` only upserted new sessions when `currentSessionId` was null** — so sessions created via "new session" + first message never appeared in the sidebar until `onRunCompleted → loadSessions` finished (~ full response later). Condition now fires on any non-empty `sid`, and the local UUID placeholder makes the sidebar update during streaming.
- **`onRunStarted`'s local upsert wrote the user's first message as `last_message_preview`**, which made the session row preview look like it was quoting the user instead of describing the agent. Now omitted during streaming; `SessionItem`'s preview falls back to `Agent: ${agent_id}` (e.g. `Agent: agent-code-search`), which is correct until `loadSessions(true)` swaps in AGNO's server-side `last_message_preview` after the run completes.

### Notes
- `src/lib/user-id.ts` is the single source of truth for `validateUserId` / `hasUserId` / `getInstanceUserId` — UI / store / form all import from there. 25 unit tests in `tests/user-id.test.ts` cover the validation matrix (empty / whitespace / too short / too long / illegal chars / boundary lengths / trim semantics / null-safe getters).
- Sessions-store gained 6 new test groups (15 assertions) in `tests/sessions-store.test.ts`: `loadSessions` passes `instance.userId` to `listSessions`, empty `userId` is omitted, defensive client filter drops cross-user rows, `userId` change auto-invalidates cache, `loadMoreSessions` also forwards `userId`, `clearSessionsCache` wipes all 3 maps.
- Chat-store gained a test in `tests/chat-store.test.ts` covering the streaming-sidebar fix: `newSession` returns a UUID, `onRunStarted` upserts during streaming (not waiting for `onRunCompleted`), `byInstance` reflects the new session.

## [0.0.9] - 2026-07-23

### Added
- **`useAutoScroll` hook** (`src/hooks/use-auto-scroll.ts`) — 取代 `ChatPanel.tsx` 里的内联 `ResizeObserver` + `onScroll` + `useRef` 状态机。背后是一个纯状态机类 `AutoScrollController` (`src/lib/auto-scroll-controller.ts`，三态：`sticky` / `user-paused` / `auto-snapping`)，30 条单元测试覆盖所有转移路径 + `markAuto` 窗口 + 嵌套 `[data-scrollable]` 滚轮过滤 + `overflow-anchor` 动态切换。修掉了 streaming 期间 (1) `behavior: smooth` 自触发 scroll 事件打断跟随；(2) 浏览器原生 anchor 拽视图两个 race。
- **`VirtualMessageList`** (`src/components/chat/VirtualMessageList.tsx`) — 用 `@tanstack/react-virtual` 把 `messages.map(MessageBubble)` 换成虚拟化列表。1000+ 条 message 的 session 只渲染 viewport + overscan 内的行（默认 80px estimateSize + overscan 6）；streaming 增长由 TanStack ResizeObserver 测量 + `useAutoScroll` 的 RO/MO 自动 snap。配套 `src/lib/timeline-cache.ts`（LRU 16 entries，借鉴 OpenCode `timelineCache`）。
- **`usePacedValue` Markdown 流式节流** (`src/hooks/use-paced-value.ts` + `src/lib/paced-value.ts`) — 借鉴 OpenCode `createPacedValue`：24ms tick + chunk 大小按 remaining 自适应（256/128/64/16/4 阶梯）+ snap-to-whitespace。短差异（≤512 字符）同步跟上；长差异每 24ms 推一段。`MarkdownStream.tsx` 用 `usePacedValue(() => children, { isLive: () => streaming })` 接管输入，streaming 期间 React 渲染频率从每 token 一次降到 ~40 fps。20 条单元测试。
- **Code block 高亮跑在 Web Worker** (`src/lib/highlight.worker.ts` + `src/lib/highlight-client.ts` + `src/hooks/use-highlight.ts`) — `Markdown.tsx` 不再 import `rehype-highlight`（之前 ~145 kB 的 highlight.js + 32 种语言常驻主线程）；react-markdown 解析阶段只识别 `language-*` 类、提取原文，把高亮请求扔给 worker。结果：(a) main bundle 减小 ~145 kB（1161 → 1016 kB，worker bundle 141 kB），(b) 长 code block 不再阻塞主线程——500 行大约 100-300ms 卡顿改后台异步。Per-key supersede + 缓存避免重复请求；18 条单元测试。`markdown-codeblock.test.ts` / `markdown-stream-render.test.ts` 调整为"SSR 阶段无 hljs-* 是预期行为"。
- **`#message-<id>` hash 深链 + scroll restoration** — 借鉴 OpenCode `use-session-hash-scroll.ts` 协议（hash ↔ active message 双向同步）简化落地。新增 `src/hooks/use-hash-scroll.ts`：监听 `popstate`/`hashchange`，把 `#message-<id>` 解析成目标 id；`writeMessageHash` 把 topmost 可见 message 写回 URL（`history.replaceState`，不污染 history；空 hash 不强行覆盖以保护分享干净 URL）。`VirtualMessageList` 加 `cacheKey`（接 TimelineCache）+ `scrollToMessageId`（rAF + `scrollToIndex(center)` 触发跳转）+ `onActiveMessageChange`（MutationObserver + debounced 150ms 找 viewport 顶部 ±80px 区间内最近 row）。`tests/use-hash-scroll.test.ts` 12 条断言。
- **chat-store coalesce + shadow map** (`src/lib/chat-buffer.ts`) — AGNO streaming 时 ~50 token/s 的 SSE event 各自走 `set(...)` 是肉眼可见的卡顿源。`pendingByMessage` 模块级 Map 把同 messageId 的多次 update 合并到一条，`queueMicrotask` 调度一次 flush。一次性 `store.setState(...)` 把整批 pending 写入 — 50 SSE event / 秒现在只 1 次 React render。Shadow map 把每条 message 的 text part 累积文本按 part 在 `parts[]` 中的 index 索引；`setMessages` 合并时（loadHistory snapshot 写入）走 `mergeShadowIntoMessage`：如果 shadow 是 incoming 的前缀（SSE 已经走得更远），用 shadow 替换对应 part text。同时 `loadHistory` 增加 active-runner 检查——ChatRunner 正在 streaming 的 session 不覆盖消息列表。17 条单元测试覆盖 coalesce + shadow merge（递归 sub-message）+ flush 调度。

### Fixed
- **Auto-scroll 被自写 hash 永久 disable 的 race** — `ChatPanel` 的 `hashTargetId` 一旦有值就触发 `pauseAutoScroll()`，但 `hashTargetId` 在两种情况下都会非 null：(1) URL 自带 `#message-X`（深链，pause 是对的）；(2) auto-tracking 滚动位置时 `writeMessageHash` 写入（**不应该** pause）。后者导致所有用户滚动都把 autoscroll 锁死——哪怕滚回底部，handleScroll 重 sticky → setStickToBottom(true)，effect 也会跟一个 `pauseAutoScroll()` 把它推回 user-paused。修复：`writeMessageHash` 新增 `{ silent: true }` 选项，标记这次写入是"自写"，在下一次浏览器派发的 `hashchange` 事件到来时，`useHashScroll` 检查新 hash 是否就是 expectedSelfWriteHash——匹配则忽略，不更新 target state。结果：自写 hash 不再算"深链"，autoscroll 在常规追踪滚动期间正常工作；真深链（reload / popstate / 用户改地址栏）依然 pause。`tests/use-hash-scroll.test.ts` +2 条断言覆盖 silent 标记 / 非-silent 不标记的差异。
- **Streaming 期间 autoscroll 不跟到底** — `useAutoScroll` 的 `ResizeObserver` observe 在 `scrollRef`（外层 fixed-height scroll container），streaming 时**外层尺寸没变**，只有内部 `VirtualMessageList` 的 `style.height` 在变。ResizeObserver 不观察 scrollHeight 变化，所以不触发 snap。修复：增加 `MutationObserver` observe scroll 容器及其子树（`childList` + `subtree: true` + `attributes: ['style','class']`），捕获 row mount/unmount / 内部 style 变化；用 `lastScrollHeight` dedup + 单 rAF 节流防止抖动。新消息到达 → 虚拟化器 inner div style.height 改 → MO 触发 → sticky 时 scrollTop = scrollHeight → 持续跟到底。`MessageBubble.tsx:145` 的 `border-l-2 border-accent/30` streaming 左侧竖条也顺手去掉（视觉噪音）。
- **VirtualMessageList 的 TimelineCache 死代码 + session 切换状态泄漏** — 之前 `ChatPanel.tsx` 给 `<VirtualMessageList>` 传了 `cacheKey={currentSessionId}` 但没传 `key={...}`，导致 React 不 remount → `useVirtualizer` 构造一次后跨 session 复用 → `initialMeasurementsCache` 只在构造时读一次 → 切 session 时 TimelineCache 总是 miss。修复：加 `key={currentSessionId}`，session 切换完整 remount → 内部 hooks / MutationObserver / RAF scheduler / scrolledRef 都重新初始化 → TimelineCache 真的生效。同时解决"虚拟化器跨 session 复用内部状态"的隐患。改动只有 1 行：`key={cacheKey}`。
- **Sub-message 的 shadow merge 漏递归 → loadHistory 会抹掉 streaming 中的 sub-agent 内容** — 原 `mergeShadowIntoMessage` 只遍历顶层 `message.parts`，不递归 `message.subMessages[]`。Team / multi-agent 场景下，runner 用 `onMessageUpdate(sub)` 把 sub 通过 buffer 写入 → shadow 按 sub.id 单独索引；但 `setMessages(loadHistory snapshot)` 时合并 shadow 走到 sub 这一层就停了，shadow map 里的 sub 累积文本不被覆盖回去。修复：递归调用自身处理 subMessages，任何 sub 替换都让顶层 message 也拿到新引用。同时 `onSubMessageFinalized` 回调之前未在 chat-store 注册（只有 `onSubMessageCreated`），现在补上 → sub run 完成时清它的 shadow。
- **Switch instance 留下陈旧 shadow map** — chat-buffer 模块级 Map，key 是 messageId 不带 instance 前缀；切到别的 instance 时旧 session 的 entry 仍然占内存。修复：ChatPanel 在 `active?.id` 变更时 cleanup `clearAllShadows()`。
- **`onRunCompleted` / `onRunError` 漏清 sub-message shadow** — 之前 `clearShadowForMessage(finalMsg.id)` 只清 top；team / multi-agent 场景下每个 sub 累积的 streaming shadow 永不释放。修复：for-loop 清 `finalMsg.subMessages[].id`。

### Notes
- 新增 [`docs/technical-debt.md`](../blob/main/docs/technical-debt.md) — 本分支遗留的 10 个已知问题（feature gap / concurrency edge / shadow map 完整性 / 性能 / 架构），按 ID 检索；最高优先级 TD-1（历史分页 → AGNO API 受限）和 TD-6（shadow 按 partIndex 索引在 part 插队时错位，待系统 review）。
- 借鉴来源：OpenCode `anomalyco/opencode` 的 `createAutoScroll` / `createPacedValue` / `markdown-worker*` / `use-session-hash-scroll` / `timelineCache` 等模式。每条 commit 引用具体借鉴文件 + 行号。

## [0.0.8] - 2026-07-22

### Added
- **Tool-call UI is readable and copy-pasteable as a unit.** Single-line header `[icon] ToolName · summary  duration ▼`; copy-all button revealed on hover. Run-command / shell show the command directly in the header (`$ ls -la`). `edit_file` / `str_replace` render as a unified line-level diff instead of JSON. `write_file` / `read_file` / `list_directory` show file path + syntax-highlighted content. The copy-all button puts name + status + args + error + result + duration on the clipboard as Markdown — the Output section is always present (empty → `_(no output)_`, calling → `_(running, no output yet)_`). Implementations in `src/components/chat/ToolCallCard.tsx` + `src/lib/tool-render-utils.ts`.
- **`pickShellOutput` normalizes every AGNO shell-result shape** seen in the wild: `{stdout, exit_code}` / `{output, exitCode}` / `{result, exit_code}` / `{output_text}` / `{response_text}` / `{message}` / Anthropic-style `[{type, text}]` content arrays. Falls back to raw result display when no recognizable field is found — no more blank expansions.
- **Consecutive read-like tool calls are grouped** into a single card to save vertical space. `MessageContent` at `src/components/chat/MessageContent.tsx:88` packs consecutive `read_file` / `list_directory` / `query_my_codebase` / `search_knowledge` calls into one `ToolCallGroup` with a `Read 3 files · /a.ts · /b.ts · +1` header. Single calls stay as regular cards.
- **Main left sidebar (AppShell) is now drag-resizable**, mirroring the chat-page column behavior. Width persists in `settings.sidebarWidth` (200–360px range), with double-click to reset. New shared primitives `src/components/common/VerticalResizeHandle.tsx` + `src/components/common/useColumnResize.ts` power both the main sidebar and the chat-page columns — `ChatPage` lost ~90 lines of inline `ResizeHandle` boilerplate in the process.

### Fixed
- **Input box now clears immediately on send.** Previously `MessageInput.tsx` cleared the textarea only after `await sendMessage(...)` resolved, so a slow / hanging AGNO request would freeze the user's text on screen. Now the text and files are cleared *synchronously* (`src/components/chat/MessageInput.tsx:57`) before the await — if `sendMessage` throws, the original text is restored so the user can retry without retyping.

### Changed
- **`/sessions` is now paginated.** Initial fetch drops from `limit=100` to `limit=15` because the endpoint is slow in some AGNO versions; the session-list footer adds a "加载更多 N/total" button (`src/components/sessions/SessionList.tsx:282`) to append more pages on demand. Per-instance pagination state in `src/stores/sessions-store.ts` (`{page, limit, totalCount, hasMore}` plus a `loadingMore` flag separate from the initial `loading`). The header count changes from `15` to `15/42` once the meta is known. `session_id` duplicates at page boundaries are deduped defensively.

### Notes
- 0.0.7 → 0.0.8 is the first release tagged after the streaming-markdown smoothness fix (cac6851) — the smoother-streaming work is in 0.0.7 but the rest of the uncommitted work between 0.0.7 and this release is bundled here.

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