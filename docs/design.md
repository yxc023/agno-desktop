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

## 5. 状态管理

### 5.1 4 个独立 store

| Store | 职责 | 持久化 |
|-------|------|--------|
| `instancesStore` | AGNO 实例 CRUD + AgnoClient 缓存 | localStorage |
| `sessionsStore` | 每个实例的 session 列表 | 内存（每次重启重拉） |
| `chatStore` | 当前 session 消息 + ChatRunner | 内存 |
| `settingsStore` | 用户偏好 | localStorage |

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
