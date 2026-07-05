# AGNO API ↔ 前端映射

> 列出所有用到的 AGNO 端点、调用位置、错误处理

## 1. 实例管理

| AGNO 端点 | 前端调用 | 实现位置 | 备注 |
|-----------|----------|----------|------|
| `GET /info` | `probeInstance` | `instances-store.ts:probeInstance` | 探活用，无 auth |
| `GET /agents` | `loadAgents` | `instances-store.ts:loadAgents` | 缓存 60s |
| `GET /config` | (未用，预留) | - | 含 quick_prompts |

## 2. Session 管理

| AGNO 端点 | 前端调用 | 实现位置 | 备注 |
|-----------|----------|----------|------|
| `GET /sessions` | `loadSessions` | `sessions-store.ts:loadSessions` | 支持 type/component_id/user_id/limit |
| `POST /sessions` | (未用，预留) | - | 显式创建 session |
| `GET /sessions/{id}` | `loadHistory` | `chat-store.ts:loadHistory` | 加载 chat_history |
| `DELETE /sessions/{id}` | `removeSession` | `sessions-store.ts:removeSession` | 删除 |
| `POST /sessions/{id}/rename` | `renameSession` | `sessions-store.ts:renameSession` | 重命名 |
| `GET /sessions/{id}/runs` | (未用，预留) | - | 获取 session 的所有 run |

## 3. Agent Run (核心)

### 3.1 `POST /agents/{agent_id}/runs` — 创建并运行

**前端调用**：`agno-client.ts:runAgent`

**请求**（multipart/form-data）：
```
message: string              # 用户输入
stream: "true"               # 启用 SSE
session_id?: string          # 已有 session
user_id?: string             # 设备级 user_id
files?: File[]               # 多模态输入
version?: string             # agent 版本
background?: "true"          # 后台模式（断线可重连）
factory_input?: JSON string  # 工厂模式参数
```

**响应**：SSE 流（`text/event-stream`）

**事件类型**（实际观察到的）：
| event | 含义 | 关键字段 |
|-------|------|----------|
| `RunStarted` | run 开始 | `run_id, session_id, agent_id` |
| `ModelRequestStarted` | 模型开始推理 | - |
| `RunContent` | 文本增量 | `content` (字符串) |
| `ReasoningContent` / `ReasoningStep` | 思考过程 | `reasoning_content` 或 `reasoning` |
| `ToolCallStarted` | 工具调用开始 | `tool: {tool_call_id, tool_name, tool_args}` |
| `ToolCallCompleted` | 工具调用完成 | `tool.result, tool.metrics` |
| `ModelRequestCompleted` | 模型推理完成 | `input_tokens, output_tokens, total_tokens` |
| `RunPaused` | HITL 暂停 | - |
| `RunCompleted` | run 完成 | - |
| `RunError` / `RunCancelled` | 失败/取消 | `error` |

**前端归约**：`chat-runner.ts:applyEvent`

### 3.2 `POST /agents/{id}/runs/{run_id}/cancel` — 取消运行

**前端调用**：`chat-store.ts:cancelRun` → `agno-client.ts:cancelAgentRun`

**场景**：用户点停止按钮，先 abort SSE stream，再调此端点确保服务端清理

### 3.3 `POST /agents/{id}/runs/{run_id}/continue` — 继续 HITL

**前端调用**：`chat-store.ts:continueRun` → `agno-client.ts:continueAgentRun`

**请求**（multipart/form-data）：
```
tools: JSON string           # [{ tool_call_id, content }]
session_id?: string
user_id?: string
stream: "true"
```

**使用场景**：agent 暂停等待工具执行结果，UI 提交后调用

### 3.4 `POST /agents/{id}/runs/{run_id}/resume` — 断线重连

**前端调用**：（v0.2 计划）`agno-client.ts:resumeAgentRun`

**请求**：
```
last_event_index: int        # 客户端最后收到的事件索引
session_id?: string
```

## 4. Approvals（v0.2 计划）

| AGNO 端点 | 用途 |
|-----------|------|
| `GET /approvals?run_id=...` | 拉取待审批列表 |
| `GET /approvals/{id}` | 详情 |
| `GET /approvals/{id}/status` | 轮询 |
| `POST /approvals/{id}/resolve` | 提交审批结果 |

**前端集成点**：`ApprovalDialog` 当前只支持 Run 级别 HITL（通过 SSE `RunPaused` 事件驱动）

## 5. Memory（v0.2 计划）

| AGNO 端点 | 用途 |
|-----------|------|
| `GET /memories?user_id=...` | 列出用户记忆 |
| `POST /memories` | 创建 |
| `PATCH /memories/{id}` | 更新 |
| `DELETE /memories/{id}` | 删除 |
| `GET /memory_topics` | 按 topic 聚合 |

## 6. Schema 适配说明

### 6.1 ToolCall schema 不一致

**AGNO 实际格式**（v2.6.x）：
```json
{
  "tool": {
    "tool_call_id": "call_xxx",
    "tool_name": "web_search",
    "tool_args": { "objective": "...", "search_queries": [...] },
    "result": "...",
    "metrics": { "duration": 1.42 }
  }
}
```

**OpenAI 风格**（部分 SDK 用）：
```json
{
  "tool": {
    "id": "call_xxx",
    "function": {
      "name": "web_search",
      "arguments": "{\"objective\":\"...\"}"
    }
  }
}
```

**前端兼容**：`chat-runner.ts:extractToolName/extractToolArgs/extractToolResult` 三层 fallback

### 6.2 时间戳单位

AGNO `updated_at` / `created_at` 返回 **Unix 秒**，但其他端点可能返回毫秒。
**前端兼容**：`session-list.tsx:formatSessionTime` 用 `> 1e12` 判断

## 7. 错误处理

| HTTP 状态 | 场景 | 前端处理 |
|-----------|------|----------|
| 401/403 | JWT 失效/权限不足 | 弹窗提示重新登录 |
| 404 | session/run 不存在 | toast 提示，刷新列表 |
| 409 | run 不在 PAUSED 状态 | 刷新当前 run 状态 |
| 429 | 限流 | toast + 自动重试（v0.2）|
| 5xx | 服务端错误 | toast 提示，显示原始错误 |
| 网络断开 | SSE 中断 | 显示重连按钮，调 `/resume` |

## 8. SSE 解析细节

`lib/sse-parser.ts` 实现：
- 按 `\n\n` 分隔事件
- 多行 `data:` 合并
- 忽略 `:` 开头的注释行
- 失败时 reader.releaseLock()
- 支持 abort signal

## 9. 已知问题

- **GET /config 未使用**：quick_prompts 字段未消费
- **Run-level HITL** 走 SSE `RunPaused` 事件，不通过 /approvals 端点
- **背景模式 (background=true) 未启用**：v0.2 才需要断线重连
- **team / workflow run 端点未实现**：v0.1 只支持 agent
