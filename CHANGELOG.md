# Changelog

All notable changes to Agno Desktop are documented here. Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **`useAutoScroll` hook** (`src/hooks/use-auto-scroll.ts`) — 取代 `ChatPanel.tsx` 里的内联 `ResizeObserver` + `onScroll` + `useRef` 状态机。背后是一个纯状态机类 `AutoScrollController` (`src/lib/auto-scroll-controller.ts`，三态：`sticky` / `user-paused` / `auto-snapping`)，30 条单元测试覆盖所有转移路径 + `markAuto` 窗口 + 嵌套 `[data-scrollable]` 滚轮过滤。修掉了之前 `behavior: "smooth"` 在 streaming 时被自己触发的 scroll 事件打断跟随的问题。
- **`VirtualMessageList`** (`src/components/chat/VirtualMessageList.tsx`) — 用 `@tanstack/react-virtual` 把 `messages.map(MessageBubble)` 换成虚拟化列表。1000+ 条 message 的 session 现在只渲染 viewport + overscan 内的行（默认 80px estimateSize + overscan 6），不再全部挂载；streaming 增长由 TanStack ResizeObserver 测量 + `useAutoScroll` 的 RO 自动 snap。配套新增 `src/lib/timeline-cache.ts`（LRU 16 entries，借鉴 OpenCode `timelineCache` 为后续 cross-mount 测量复用做准备）。
- **Code block 高亮跑在 Web Worker** (`src/lib/highlight.worker.ts` + `src/lib/highlight-client.ts` + `src/hooks/use-highlight.ts`) — `Markdown.tsx` 不再 import `rehype-highlight`（之前 ~145 kB 的 highlight.js + 32 种语言常驻主线程）；现在 react-markdown 解析阶段只识别 `language-*` 类、提取原文，把高亮请求扔给 worker。Worker 用同一个 highlight.js + 32 语言，但 tokenize 在后台线程跑——主线程不再因为长 code block 阻塞。结果：(a) SSR / 客户端 bundle 减小 ~145 kB（dist 1161 → 1016 kB，worker bundle 141 kB），(b) 历史回放里 N 个 code block 并行发请求时主线程保持响应。Per-key supersede + 缓存避免重复请求；18 条单元测试覆盖 Worker 客户端协议（request/response、supersede、cache、error fallback、destroy）。修改：`Markdown.tsx:55-57` 删 `rehype-highlight` + 新增 `stringifyChildren`；`CodeBlock.tsx` 改用 `useHighlight` + `dangerouslySetInnerHTML`；现有 `markdown-codeblock.test.ts` / `markdown-stream-render.test.ts` 调整为"SSR 阶段无 hljs-* 是预期行为"。
- **`#message-<id>` hash 深链 + scroll restoration** — 借鉴 OpenCode `use-session-hash-scroll.ts` 的核心协议（hash ↔ active message 双向同步）简化落地。新增 `src/hooks/use-hash-scroll.ts`：监听 `popstate`/`hashchange`，把 `#message-<id>` 解析成目标 id；导出 `writeMessageHash` 把 topmost 可见 message 写回 URL（`history.replaceState`，不污染 history；空 hash 不强行覆盖以保护分享干净 URL）。`VirtualMessageList` 加 `cacheKey`（接 TimelineCache 跨 mount 复用测量；切回同 session 不再走 80px fallback 重测）+ `scrollToMessageId`（rAF + `scrollToIndex(center)` 触发跳转到目标）+ `onActiveMessageChange`（MutationObserver 监听 children 变化 → debounced 150ms 找 viewport 顶部 ±80px 区间内最近 row → 回调）。`ChatPanel` 把三者串起来：`useHashScroll` → `scrollToMessageId` → 渲染期间不再 auto-snap-to-bottom（深链定位优先）；`handleActiveMessageChange` → `writeMessageHash` → 滚动时 URL 自动更新。`tests/use-hash-scroll.test.ts` 12 条断言覆盖 parse 协议 + write 策略（current 已等于目标 / 是 message hash / 空 hash 不写 / 非 message hash 不写）。
- **Deep link 跨 reload 的 applyHash rAF polling** — `VirtualMessageList` 的 `scrollToMessageId` effect 改成多帧轮询：找 `[data-message-id="${id}"]` 是否已挂载且 `offsetHeight>0`（已测量）→ 是才 `scrollToIndex(center, smooth)`；否则下一帧重试，最长 8 帧（≈135ms）后兜底用估计高度。`scrolledRef` 锁住"已跳转过"的 target id，防止 streaming 期间 `messages` 数组每次更新都重滚。同时 `ChatPanel` 在 `hashTargetId` 设置时调 `useAutoScroll.pause()`——避免 useAutoScroll 的 ResizeObserver 在虚拟化器内容变化时把视口拉回底部，覆盖 hash 跳转位置。
- **chat-store coalesce + shadow map** — AGNO streaming 时 ~50 token/s 的 SSE event 各自走 `set(...)` 是肉眼可见的卡顿源。新增 `src/lib/chat-buffer.ts`：模块级单例 `pendingByMessage: Map`，`enqueueMessageUpdate(sessionId, message)` 把同 messageId 的多次 update 合并到一条（最新覆盖旧），`queueMicrotask` 调度一次 flush。flush 回调（chat-store 模块加载时注册到 `setBufferFlushCallback`）一次性 `store.setState(...)` 把整批 pending 写入 `messagesBySession` + `idIndexBySession`——50 SSE event / 秒现在只 1 次 React render。Shadow map（同样在 chat-buffer）：每条 message 的 text part 累积文本按 part 在数组中的 index 存到 `shadowTextByMessage`。`setMessages` 合并时（loadHistory snapshot 写入）走 `mergeShadowIntoMessage`：如果 shadow 是 incoming 的前缀（SSE 已经走得更远），用 shadow 替换对应 part text。同时 `loadHistory` 增加 active-runner 检查：ChatRunner 正在 streaming 的 session 不覆盖消息列表，避免极端 race；onRunCompleted / onRunError 清理 shadow。14 条单元测试覆盖 coalesce（同 messageId 合并 / 不同不合并）+ shadow merge 三种判定（前缀 / 不前缀 / 无 shadow）+ clear / clearAll + flush 调度。

### Fixed
- **Auto-scroll 被自写 hash 永久 disable 的 race** — `ChatPanel` 的 `hashTargetId` 一旦有值就触发 `pauseAutoScroll()`，但 `hashTargetId` 在两种情况下都会非 null：(1) URL 自带 `#message-X`（深链，pause 是对的）；(2) auto-tracking 滚动位置时 `writeMessageHash` 写入（**不应该** pause）。后者导致所有用户滚动都把 autoscroll 锁死——哪怕滚回底部，handleScroll 重 sticky → setStickToBottom(true)，effect 也会跟一个 `pauseAutoScroll()` 把它推回 user-paused。修复：`writeMessageHash` 新增 `{ silent: true }` 选项，标记这次写入是"自写"，在下一次浏览器派发的 `hashchange` 事件到来时，`useHashScroll` 检查新 hash 是否就是 expectedSelfWriteHash——匹配则忽略，不更新 target state。`ChatPanel` 把 `onActiveMessageChange` → `writeMessageHash` 调用改成 `silent: true`。结果：自写 hash 不再算"深链"，autoscroll 在常规追踪滚动期间正常工作；真深链（reload / popstate / 用户改地址栏）依然 pause。`tests/use-hash-scroll.test.ts` +2 条断言覆盖 silent 标记 / 非-silent 不标记的差异。
- **Streaming 期间 autoscroll 不跟到底** — "跳到底部"按钮工作，但 streaming 期间新消息到达时容器不自动滚动。原因：`useAutoScroll` 的 `ResizeObserver` observe 在 `scrollRef`（外层 fixed-height scroll container），streaming 时**外层尺寸没变**，只有内部 `VirtualMessageList` 的 `style.height` 在变。ResizeObserver 不观察 scrollHeight 变化，所以不触发 snap。修复：增加 `MutationObserver` observe scroll 容器及其子树（`childList` + `subtree: true` + `attributes: ['style','class']`），捕获 row mount/unmount / 内部 style 变化；用 `lastScrollHeight` dedup + 单 rAF 节流防止抖动。新消息到达 → 虚拟化器 inner div style.height 改 → MO 触发 → sticky 时 scrollTop = scrollHeight → 持续跟到底。`MessageBubble.tsx:145` 的 `border-l-2 border-accent/30` streaming 左侧竖条也顺手去掉（视觉噪音）。
- **VirtualMessageList 的 TimelineCache 死代码 + session 切换状态泄漏** — 之前 `ChatPanel.tsx` 给 `<VirtualMessageList>` 传了 `cacheKey={currentSessionId}` 但没传 `key={...}`，导致 React 不 remount → `useVirtualizer` 构造一次后跨 session 复用 → `initialMeasurementsCache` 只在构造时读一次 → 切 session 时 TimelineCache 总是 miss。修复：加 `key={currentSessionId}`，session 切换完整 remount → 内部 hooks / MutationObserver / RAF scheduler / scrolledRef 都重新初始化 → TimelineCache 真的生效。同时解决"虚拟化器跨 session 复用内部状态"的隐患（之前 MO observer 没 disconnect 重启、useRef 累积）。改动只有 1 行：`key={cacheKey}`。
- **Sub-message 的 shadow merge 漏递归 → loadHistory 会抹掉 streaming 中的 sub-agent 内容** — 原 `mergeShadowIntoMessage` 只遍历顶层 `message.parts`，不递归 `message.subMessages[]`。Team / multi-agent 场景下，runner 用 `onMessageUpdate(sub)` 把 sub 通过 buffer 写入 → shadow 按 sub.id 单独索引；但 `setMessages(loadHistory snapshot)` 时合并 shadow 走到 sub 这一层就停了，shadow map 里的 sub 累积文本不被覆盖回去。修复：递归调用自身处理 subMessages，任何 sub 替换都让顶层 message 也拿到新引用。同时 `onSubMessageFinalized` 回调之前未在 chat-store 注册（只有 `onSubMessageCreated`），现在补上 → sub run 完成时清它的 shadow。
- **Switch instance 留下陈旧 shadow map** — chat-buffer 模块级 Map，key 是 messageId 不带 instance 前缀；切到别的 instance 时旧 session 的 entry 仍然占内存。修复：ChatPanel 在 `active?.id` 变更时 cleanup `clearAllShadows()`。
- **`onRunCompleted` / `onRunError` 漏清 sub-message shadow** — 之前 `clearShadowForMessage(finalMsg.id)` 只清 top；team / multi-agent 场景下每个 sub 累积的 streaming shadow 永不释放。修复：for-loop 清 `finalMsg.subMessages[].id`。

### Fixed
- **Chat autoscroll 现在跟得住长回复、不会"中途掉链"**。之前 `ChatPanel.tsx:128-143` 的 `ResizeObserver` + `behavior: "smooth"` 组合有两个隐藏问题：(1) `scrollTo({behavior: "smooth"})` 触发的 scroll 事件会被 `onScroll` 误判为"用户滚走了"——正在 streaming 时容器突然不再 auto-scroll；(2) 没设 `overflow-anchor`，浏览器原生 anchor 在 streaming 期间往下拽视图。新 hook 提供 `markAutoMs`（1500ms）窗口让自触发 scroll 不被误读，并在 `sticky` 时把容器 `overflow-anchor` 设为 `none` 让原生 anchor 别打架；同时支持 wheel 向上滚检测 + 嵌套 `[data-scrollable]` 滚轮过滤。
- **Markdown 流式渲染现在按 ~24ms 节奏释放文本，而不是每 token 一次 React render**。新增 `usePacedValue` hook (`src/hooks/use-paced-value.ts`) + 纯逻辑类 `PacedValueController` (`src/lib/paced-value.ts`，20 条单元测试)。借鉴 OpenCode `createPacedValue`：短差异（≤512 字符）同步跟上；长差异每 24ms 推一段，chunk 大小按 remaining 自适应（256/128/64/16/4 阶梯），snap 到最近的空白/标点避免"半截 token"。`MarkdownStream.tsx` 现在用 `usePacedValue(() => children, { isLive: () => streaming })` 接管输入，配合已有的 `React.memo` 让 `<Markdown>` 在 paced text 不变时跳过整次 render。非流式（`streaming=false` 或历史回放）一次性同步跟上，零延迟。
- **长 session（1000+ 条消息）现在不会一次 mount 全部 MessageBubble**。之前 `ChatPanel.tsx` 的 `messages.map((m) => <MessageBubble />)` 在切到长 session 时会一次性 mount 所有 message，每个都跑自己的 Markdown 解析。`VirtualMessageList` 只挂载 viewport 内 + overscan 6 条，单 session DOM 节点数从 O(N) 降到 O(可见窗口)。
- **长 code block 不再阻塞主线程**。之前 `rehype-highlight` 在 `react-markdown` 解析阶段同步 tokenize——500 行代码块大约 100-300ms 主线程卡顿。改用 Web Worker 后：高亮在后台跑，响应回到主线程后用 `dangerouslySetInnerHTML` patch `<code>` 内容；用户首次看到的是 plain text（<50ms），紧接着切换为高亮版本（worker 响应通常 < 100ms）。stream 时 unclosed fence 已经在 prefix/tail 拆分里整段走 tail，所以流式阶段根本不触发高亮。

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

## Unreleased

### Added
- **Tool-call UI is now readable and copy-pasteable as a unit.** Previously the JSON dump on every tool was opaque — you could only copy `args` or `result` separately, and shell commands looked like every other tool. `src/components/chat/ToolCallCard.tsx` now renders tool-specific views:
    - `execute_command` / `shell`: command as a `bash` code block, remaining args as a key-value table, output split into `stdout` / `stderr` with the exit code.
    - `read_file` / `write_file` / `list_directory`: file path as a header chip; content shown in a syntax-highlighted block with the language inferred from the file extension (`src/lib/tool-render-utils.ts:39`).
    - `edit_file` / `str_replace` / `edit`: a unified diff view (line-level LCS, `src/lib/tool-render-utils.ts:78`) with green-add / red-del rows instead of JSON.
    - All other tools: key-value table for args, JSON fallback for results.
  Plus a **new "copy entire tool call" button** in the header — one click puts name + status + args + error + result + duration on the clipboard as Markdown (`formatToolCallForCopy` in `src/lib/tool-render-utils.ts:127`). Especially useful when pasting a tool invocation into an issue or another chat.
- **Main left sidebar (AppShell) is now drag-resizable**, mirroring the chat-page column behavior. New `sidebarWidth` field in `src/stores/settings-store.ts:46` persists the chosen width (200–360px range). Double-click the handle to reset to default. Collapsed mode keeps the fixed 56px width and hides the handle. Implementation is shared via two new components — `src/components/common/VerticalResizeHandle.tsx` and `src/components/common/useColumnResize.ts` — replacing the inline `ResizeHandle` in `src/pages/ChatPage.tsx`.

### Fixed
- **Input box now clears immediately on send.** Previously `MessageInput.tsx:59` cleared the textarea only *after* `await sendMessage(...)` resolved, so a slow / hanging AGNO request would keep the user's text frozen on screen and they'd have to delete it manually to type the next message. Now the text and files are cleared *synchronously* before the await (`src/components/chat/MessageInput.tsx:57`), letting the user keep typing immediately. If `sendMessage` throws, the original text is restored so the user can retry without retyping.
- **Slight jitter + brief blank flash in the chat area during streaming.** The chat panel used to re-render and re-parse the markdown of every message on every SSE chunk, which combined with the autoscroll `useEffect` (whose `messages` dep kept `scrollTop`/`scrollHeight` reads firing) caused two user-visible artifacts:
    1. While the assistant was streaming, the entire message area would micro-jitter as `react-markdown` (with `rehype-highlight`'s `detect: true`) re-ran on every chunk, even for already-finalized messages.
    2. Quickly scrolling up/down during streaming would briefly flash blank because the browser was busy re-parsing markdown instead of painting frames.

  Three coordinated optimizations address both:
    - **`<Markdown>` is now `React.memo`-wrapped.** Text `children` is a primitive, so a deep-equal on props is sufficient to skip re-parse. With `chat-store.replaceInTree` keeping unchanged siblings' references, historical message bails out entirely on streaming ticks.
    - **New `<MarkdownStream>` (used by `MessageContent` for text parts) splits a streaming text into a "stable prefix" and a "live tail" at the last paragraph / code-fence boundary.** The prefix goes through `<Markdown>` (cache-friendly via memo); the tail is rendered as plain text with a streaming cursor. During streaming, most ticks only grow the tail — the prefix ref stays stable and its parsed DOM is reused. Inspired by OpenCode's `packages/session-ui/src/components/markdown-stream.ts`.
    - **Autoscroll no longer depends on `messages`.** A `ResizeObserver` watches the scroll container's size and triggers `scrollTo` only when the actual rendered height changed. Replaces the previous `useEffect` that ran on every `messages` ref change (every SSE chunk), eliminating the per-chunk forced layout.

  Net effect: streaming is visibly smoother, and `react-markdown` does at most O(1 paragraph) parse work per chunk instead of O(everything-so-far) work per chunk.

### Notes
- No behavior or UX changes outside of streaming smoothness — markdown still renders the same final output (covered by `tests/markdown-stream-render.test.ts` and `tests/markdown-codeblock.test.ts`).

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