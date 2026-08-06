# Agno Desktop 设计稿

> v0.1 范围：聊天核心

## 1. 设计目标

1. **多实例隔离**：用户能在同一界面连接多个 AGNO AgentOS，session / 配置各自独立
2. **流式体验**：token 实时渲染、思考/工具/结果分级展示、流畅不卡顿
3. **完整细节**：工具调用必须看到输入/输出/耗时，工具结果按类型智能渲染
4. **本地优先**：零后端、零遥测、断网可用（除了实际对话）

## 2. 整体架构

```
┌───────────────────────  Browser (Chrome/Safari/Firefox)  ───────────────────┐
│  ┌────────────────────  React 19 + Vite 8  ───────────────────────────┐  │
│  │  Pages: /chat /instances /memory /settings                         │  │
│  │  ┌──────────────────  Zustand Stores  ────────────────────┐        │  │
│  │  │  • instancesStore   (实例列表 + 当前 + clients 缓存)     │        │  │
│  │  │  • sessionsStore    (每个实例的 session 列表)            │        │  │
│  │  │  • chatStore        (当前 session 消息 + ChatRunner)    │        │  │
│  │  │  • settingsStore    (用户偏好: theme/userId/...)        │        │  │
│  │  │  • uiStore          (对话框/审批状态)                   │        │  │
│  │  └─────────────────────────────────────────────────────┘        │  │
│  │  ┌──────────────────  Lib  ──────────────────────────────┐        │  │
│  │  │  • AgnoClient        (fetch wrapper + SSE)            │        │  │
│  │  │  • ChatRunner        (SSE event → message reducer)     │        │  │
│  │  │  • sse-parser        (text/event-stream → events)      │        │  │
│  │  │  • storage           (localStorage helpers)            │        │  │
│  │  └─────────────────────────────────────────────────────┘        │  │
│  └────────────────────────┬────────────────────────────────────────┘  │
│                           │ HTTPS + SSE                                │
│              ┌────────────┴────────────┐                               │
│              │  Vite Dev Proxy (/api)  │ (绕过浏览器 CORS)            │
│              └────────────┬────────────┘                               │
└───────────────────────────┼──────────────────────────────────────────┘
                            │ HTTP
            ┌───────────────┴───────────────┐
            │  AGNO AgentOS 实例              │
            │  - GET  /info /agents /sessions │
            │  - POST /agents/{id}/runs (SSE) │
            │  - POST /agents/{id}/runs/{run}/continue │
            │  - POST /agents/{id}/runs/{run}/resume    │
            │  - POST /agents/{id}/runs/{run}/cancel    │
            │  - GET/POST /approvals /memory /knowledge │
            └────────────────────────────────┘
```

## 3. 数据流：一次 chat run

```
User 输入文本
    ↓
MessageInput.handleSend()
    ↓
useChatStore.sendMessage({text, files})
    ↓
[user message] → chat-store.appendMessage(sessionId, userMsg)
    ↓
ChatRunner.run({client, agentId, message, sessionId, ...}, callbacks)
    ↓
AgnoClient.runAgent(agentId, body) → SSE stream
    ↓
for await (event of stream):
    parseSSEData<AgRunResponse>(event)
    ChatRunner.applyEvent(data, callbacks)
        ├─ RunStarted       → 记录 run_id/session_id，更新 message
        ├─ RunContent       → appendText(delta) → 更新 message.parts[].text
        ├─ ReasoningContent → appendReasoning(text) → 更新 message.parts[].reasoning
        ├─ ToolCallStarted  → startToolCall(tc) → push tool_call part
        ├─ ToolCallCompleted→ completeToolCall(tc) → 更新 status='completed' + result
        ├─ RunPaused        → collectPauseInfo → message.awaitingInput=true
        ├─ RunCompleted     → message.status='completed'
        └─ RunError         → message.status='error' + 错误 part
    callbacks.onMessageUpdate(message)
        ↓
        useChatStore.updateMessage(sessionId, messageId, () => message)
        ↓
        React re-render MessageBubble
```

## 4. UI 设计

### 4.1 布局

```
┌────────────────────────────────────────────────────────────────┐
│  Sidebar  │  ChatPage                                          │
│  ┌──────┐ │  ┌──────────┬──────────────────┬──────────────────┐│
│  │ Logo │ │  │ Sessions │  ChatPanel       │  Instances       ││
│  ├──────┤ │  │ (搜索    │  ┌──────────────┐│  (状态/AGNO 版本 ││
│  │ Chat │ │  │  + 列表  │  │ Agent 切换   ││   /Agents 数等)  ││
│  │ Inst │ │  │  100 条) │  ├──────────────┤│                  ││
│  │ Mem  │ │  │          │  │  Messages    ││                  ││
│  │ Set  │ │  │          │  │  (流式渲染)  ││                  ││
│  ├──────┤ │  │          │  │              ││                  ││
│  │ Fold │ │  │          │  │              ││                  ││
│  └──────┘ │  └──────────┴─┴──────────────┴┴──────────────────┘│
│           │  ┌────────────────────────────────────────────┐   │
│           │  │ MessageInput (固定在底部)                  │   │
│           │  └────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

- **左侧导航栏**：可折叠，4 个主路由 + 当前实例状态
- **Sessions 栏**：可拖拽调整宽度，搜索 + 列表 + 新建
- **ChatPanel**：顶部 agent 切换 + 中部消息流 + 底部输入框
- **Instances 栏**：实例探活状态、AGNO 版本、agents 列表

### 4.2 消息气泡

```
┌─────────────────────────────────────────────────────┐
│ 👤 You  [web-search]  2 分钟前                  📋   │
│ What's the capital of France?                       │
├─────────────────────────────────────────────────────┤
│ 🤖 Assistant  [web-search]  2 分钟前           📋   │
│ ┌─ 🧠 思考过程 ────────────────────────────┐  [▼]    │
│ │ The user is asking a geography question… │         │
│ │ Step 1: Recall the capital of France    │         │
│ │ Step 2: Formulate response              │         │
│ └─────────────────────────────────────────┘         │
│                                                     │
│ ┌─ 🔍 Web Search  web_search  1.2s ✓ ──── [▲] ┐    │
│ │ 输入参数                                          │  │
│ │ {                                                │  │
│ │   "objective": "find France capital",            │  │
│ │   "search_queries": ["capital of France"]       │  │
│ │ }                                                │  │
│ │ ───────────────────────────────                  │  │
│ │ 输出结果                                          │  │
│ │ 🔗 Paris - Wikipedia                              │  │
│ │    Paris is the capital and most populous city   │  │
│ │ 🔗 France Capital - Britannica                    │  │
│ │    ...                                            │  │
│ └──────────────────────────────────────────────┘    │
│                                                     │
│ The capital of France is **Paris**.                 │
│                                                     │
│                                              245 tok │
└─────────────────────────────────────────────────────┘
```

### 4.3 颜色与主题

- **默认 dark mode**：bg `zinc-950`，card `zinc-900`，border `zinc-800`
- **light mode**：bg `white`，card `zinc-50`，border `zinc-200`
- **品牌色**：紫蓝渐变（Logo + 强调）
- **tool 状态色**：
  - calling: blue-500 (动画)
  - completed: green-500
  - error: red-500
- **reasoning 块**：violet-500/15 背景 + 左边框

### 4.4 字体

- **正文**: Inter
- **代码**: JetBrains Mono
- **Markdown 标题**: Inter SemiBold

### 4.5 文件预览侧栏 (File Preview Panel)

Chat 回复里出现的静态文件链接（`.md` / `.txt` / 代码 / 图片 / `.html`）自动在右侧 tab 侧栏里渲染，而不是跳出客户端去系统浏览器。设计要点：

- **触发点**：`src/components/markdown/Markdown.tsx` 的 `<a>` 自定义渲染器。点击时 `detectPreviewKind(href)` 判断扩展名；命中（md / text / code / image / html）→ 调 `uiStore.previewFile(sessionId, href, kind)`，未命中 → 保留原 `openExternalUrl` 行为。
- **状态**：`ui-store` 新增 `filePreviewPanelOpen` / `filePreviewTabs` / `activeFileTabId`。tab id = `hash(sessionId + "|" + url)` —— 同 URL 同 session 复用 tab（重新 fetch），跨 session 视为不同 tab。切 session 时该 session 的 tabs 仍在 store 里、只是不渲染；切回时恢复。
- **渲染管线**：`FilePreviewPanel` 组件 (`src/components/chat/FilePreviewPanel.tsx`) 在 `state === "loading"` 时启动 `fetchPreviewContent(url)`（`src/lib/file-fetcher.ts` —— 5MB 上限 + 错误归一化 + latin1 fallback + abort signal）。按 `kind` 分发：md → 现有 `Markdown`，text → `<pre>` mono，code → `CodeBlock` + worker 高亮，image → `<img>`，html → `<iframe sandbox="">`。
- **错误兜底**：失败 tab 显示 `在浏览器中打开` + `复制 URL`，确保 CORS-blocked 的 AGNO 实例 URL 仍有出路。
- **持久化**：tab 列表本身**不**持久化（与 chat 消息策略一致）；宽度 `filePreviewWidth` 持久化到 `settingsStore`。
- **Tauri 优势**：`tauri-plugin-http` 已绕过 CORS，Tauri runtime 下任何 URL 直接 fetch；浏览器 runtime 下 AGNO 实例自身 URL 仍可能 CORS 失败（v1 不加新 proxy，详见 `docs/plans/2026-08-06-file-preview-panel-design.md`）。

### 4.6 消息展示详细程度 (Message Verbosity)

用户在设置 → 对话偏好 里控制三种维度，全部走 `settingsStore`，渲染层 (`MessageContent.tsx`) 即时生效（toggle 一改下次 render 就应用，不需要清空 stream）：

- **`collapseReasoning`**（已有，默认 `false`）：reasoning 块渲染但默认折叠，header 仍可见，可手动展开。
- **`hideReasoning`**（新增，默认 `false`）：完全不渲染 reasoning part。在 `partitionParts` 之前先 `.filter(p => p.type !== "reasoning")`。和 `collapseReasoning` 是正交维度 —— 同时打开时块直接消失，关闭折叠也无法恢复。
- **`briefToolCalls`**（新增，默认 `false`）：连续 ≥ 2 个 tool_call 折叠成一张 `ToolCallGroup` chip（不分类型），头部显示 `N 次调用 · tool_name×count · 总耗时` + 错误计数徽章；点击展开内联看完整 `ToolCallCard`。关闭时恢复旧的"只合并 read-like"行为（向后兼容默认）。单个 tool_call 仍按 `ToolCallCard` 直渲染，不做 chip 包装。

partition 算法抽出到 `src/lib/message-verbosity.ts` 作为纯函数（25 个 assertion 在 `tests/message-verbosity.test.ts` 覆盖 brief/non-brief 双路径 + 顺序不变量）。两个开关在主流程和 sub-agent 侧栏都生效（都复用 `MessageContent`）。

## 5. 状态管理

### 5.1 4 个独立 store

| Store | 职责 | 持久化 |
|-------|------|--------|
| `instancesStore` | AGNO 实例 CRUD（含 per-instance `userId`）+ AgnoClient 缓存 | localStorage |
| `sessionsStore` | 每个实例的 session 列表 | 内存（每次重启重拉） |
| `chatStore` | 当前 session 消息 + ChatRunner | 内存 |
| `uiStore` | 临时 UI 状态（sub-agent 面板栈、命令面板、HITL approval、添加实例对话框、`filePreviewPanelOpen` / `filePreviewTabs` 预览侧栏） | 内存 |
| `settingsStore` | 用户偏好（主题 / 滚动 / 打字机 / auto-update / filePreviewWidth / hideReasoning / briefToolCalls 等；不含 userId） | localStorage |

**设计原则**：
- 每个 store 职责单一，避免互相引用
- 实例相关的客户端缓存放在 instancesStore（按 id 索引）
- 当前 session id 在 sessionsStore，消息在 chatStore（按 sessionId 索引）
- 跨 store 通信用 `useXxxStore.getState()` 同步获取

### 5.2 关键不变量

1. **activeInstanceId 唯一**：同时只有一个活跃实例
2. **sessionId 唯一标识**：所有消息按 sessionId 索引
3. **ChatRunner 唯一**：一次只有一个 runner 实例，abort 后再创建
4. **localStorage 仅存轻量数据**：实例配置、用户偏好；不存消息内容（避免大体积）
5. **user_id per-instance**：`AgnoInstance.userId` 是该实例的身份，**不同实例可有不同 user_id**。AGNO 用它归类该实例的 memory / session / user-level 数据。聊天时 `chat-store.sendMessage` 把 `active.userId` 透传给 `ChatRunner.run`，最终写到 `POST /agents/{id}/runs` 的 `user_id` 字段；拉历史 session 列表时 `sessions-store.loadSessions` 把 `inst.userId` 作为 `user_id` query 透传给 `GET /sessions?user_id=...`，并在客户端做一次 defensive 过滤（服务端不严格过滤时仍能隔离）。`sessionsUserId[instanceId]` 隐式作为缓存 key 的一部分——实例的 userId 一变就自动 force reload，不需要调用方显式 invalidate。dev / staging / prod 不同实例的对话、记忆自然隔离。

## 6. SSE 处理细节

### 6.1 为什么用 fetch + ReadableStream

- `EventSource` 只支持 GET，无法传 `multipart/form-data` body
- AGNO 的 run 端点是 POST + FormData
- 自己解析 SSE 可以拿到更细粒度的事件控制

### 6.2 事件归约策略

- `RunContent` 的 `delta` 直接 append 到最后一个 text part
- `ToolCallStarted` 立即 push 新 part（status: 'calling'）
- `ToolCallCompleted` 找到对应 part 更新（status: 'completed' + result）
- `RunPaused` 触发 ApprovalDialog
- 重复事件通过 `run_id` + `event_index` 去重

### 6.3 Abort 与 Resume

```ts
// 取消
runner.abort() → AbortController.abort() → fetch reader cancel
                + client.cancelAgentRun() → 服务端清理

// 断线重连（v0.2）
runner.resume(lastEventIndex)
  → AgnoClient.resumeAgentRun(agentId, runId, { last_event_index })
  → 服务端重放缺失 event
```

## 7. 已知 trade-off

1. **react-markdown + highlight.js bundle 较大**（~700KB gzipped 320KB）。可考虑换 Shiki（更小但更慢）
2. **没有虚拟滚动**：长 session（>1000 条消息）会卡。v0.2 加 react-virtuoso
3. **localStorage 同步写入**：极端情况下阻塞主线程。数据量小所以问题不大
4. **没做连接池**：切换实例时直接复用 client，不做连接复用
5. **Markdown XSS**：rehype-raw 可能渲染恶意 HTML。AGNO 返回的是可信内容，但 v0.2 应该加 sanitize

## 8. 后续迭代建议

| 优先级 | 任务 | 估时 |
|--------|------|------|
| P0 | Approval 完整流（列表 + 详情 + 解决） | 2d |
| P0 | Memory 浏览页面（按 topic 聚合） | 1d |
| P1 | Trace 查看（按 session 聚合） | 3d |
| P1 | 长 session 虚拟滚动 | 1d |
| P2 | Light mode 完善 | 0.5d |
| P2 | 多窗口（Tauri 包装） | 5d |
| P3 | Knowledge 搜索 | 2d |

## 相关文档

- [`api-mapping.md`](./api-mapping.md) — AGNO OpenAPI ↔ 前端用法
- [`technical-debt.md`](./technical-debt.md) — `feature/chat-streaming-ux` 分支遗留的已知问题与设计债
