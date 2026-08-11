# Requirement-Centric Workspaces — Design

> 实验性：从「AGNO 工作台」转型到「围绕需求的多 agent 工作协同中枢」。`/works` 页面彻底重构。

## 1. 定位变化

| | 旧（已废） | 新 |
|---|---|---|
| 锚点 | AGNO session | **Requirement** |
| agent 平台 | 只 AGNO | **AGNO + Claude Code + opencode + …** |
| PDCA | 无 | 显式 plan / do / check / deliver |
| 文件系统 | 仅 markdown 链接 | 一等公民（产出文档 + 浏览 + 修改 + commit） |
| Git | 无概念 | branches / MRs / commits / 时间线 |
| 人在环 | 只在 chat 出现 | 与 agent 同列，commit / 介入 session 都自然 |

## 2. 已对齐的架构决策

| # | 问题 | 决策 |
|---|---|---|
| Q1 | Requirement 元数据存哪 | **文件系统**：`requirements/<id>.md` + frontmatter；app 只读不写（v1） |
| Q2 | session ↔ requirement 怎么关联 | **手工绑定**：agent 启动时用户在 UI 指定 req id；binding 落"数据库"（mock 为内存对象，真接 AGNO 时落 AGNO DB / 本地 SQLite） |
| Q3 | Tauri FS / git 集成是否要做 | **全 mock**：v1 demo 不接 Tauri fs / git CLI，纯渲染 mock 数据 |
| Q4 | 一个 req 几个 repo | **多 repo**：一个 req 关联 `repos: string[]`；每个 repo 独立 branches / MRs |

## 3. 实体模型

```
Requirement
├─ frontmatter (id, title, status, assignees, repos, createdAt, updatedAt)
├─ stages[]           Stage { kind, status, startedAt, doneAt }
│    └─ sessions[]    Session { platform, externalRef, status, canIntervene }
├─ documents[]        Document { repoPath, filePath, kind, lastEditedBy, lastEditedAt }
├─ branches[]         Branch { repoPath, name, lastCommit, ahead, behind }
├─ mrs[]              MR { repoPath, branch, title, status, reviewers }
└─ commits[]          Commit { sha, authorType, agentPlatform?, message, timestamp, filesChanged[] }
```

```ts
type AgentPlatform = "agno" | "claude-code" | "opencode" | "codex" | "human";
type StageKind = "plan" | "do" | "check" | "deliver";

interface Requirement {
  id: string;             // e.g. "REQ-234"
  title: string;
  status: "active" | "paused" | "delivered" | "archived";
  createdAt: number;
  updatedAt: number;
  assignees: Array<{ kind: "human" | "agent"; name: string; platform?: AgentPlatform }>;
  repos: string[];        // 关联 repo 根路径列表
  bodyPath?: string;      // requirements/<id>.md 路径（v1 mock）
  stages: Stage[];
  documents: Document[];
  branches: Branch[];
  mrs: MR[];
  commits: Commit[];
}
```

### 3.1 Session 绑定（Q2 的实现）

`Session.requirementId` 字段由「启动时指定」填充，不是从文件名 / 分支名推断。绑定记录可在多平台之间共享：

```ts
interface SessionBinding {
  externalRef: string;       // 平台侧 session id
  platform: AgentPlatform;
  requirementId: string;
  stageKind: StageKind;
  boundAt: number;
}
```

启动 session 的 UX（`StartSessionDialog`）：

```
┌─ 新建工作会话 ────────────────────────┐
│ 需求 (已选): REQ-234 · Add OTLP tracing│
│                                        │
│ 阶段:    (○) plan  (●) do  ( ) check  ( ) deliver
│                                        │
│ Agent 平台: [AGNO ▾]   ← 多平台切换   │
│ 初始消息:   [________________]        │
│                                        │
│              [取消]  [启动并打开]      │
└────────────────────────────────────────┘
```

## 4. UI 结构

```
/works 页面
┌────────────────┬───────────────────────────────────────────────┐
│ Requirement    │ Header (title / status / assignees / repos)   │
│ 列表 (左 320)  ├───────────────────────────────────────────────┤
│                │ PDCA 时间线 (横向 stage 进度)                  │
│ + 搜索         ├───────────────────────────────────────────────┤
│ + status 过滤  │ Tabs: Sessions | Git | Documents              │
│ + stage 过滤   │                                                │
│                │ Active tab 内容                                │
│                │                                                │
│                │                                                │
│ [+ 新建需求]    │ [+ 启动会话] 浮在右下角                        │
└────────────────┴───────────────────────────────────────────────┘
```

**Tabs 内容**：
- **Sessions**：按 stage 分组，每条带 platform badge + 状态 + 「打开/恢复/介入」按钮
- **Git**：commits 时间线（人/agent 分色）+ branches 列表 + MRs 列表
- **Documents**：按 repo 分组的文件树，hover 显示 last edited by

## 5. Mock 范围（v1 demo）

✅ 渲染 3 个 Requirement 的完整骨架
✅ Sessions 跨平台（AGNO + Claude Code + opencode）
✅ Git 时间线混合 human / agent commits
✅ 多 repo 文件分组
✅ StartSessionDialog 展示 req-binding UX

❌ 真实文件系统读写
❌ 真实 git 操作
❌ 真实 session 启动（仅展示 UX）
❌ Polling / SSE
❌ 新建 Requirement 对话框（先做"启动 session"对话框演示 req-binding）

## 6. 后续路径

1. `lib/requirement-store.ts`：frontmatter 解析 + session binding 持久化
2. Tauri fs 集成：`requirements/<id>.md` 读写 + watch
3. Tauri shell 集成：`git log` / `git branch` / `gh pr list`
4. 各平台 session 启动 hook（AGNO → `POST /agents/{id}/runs`；Claude Code → CLI spawn；opencode → 类似）
5. Polling / streaming（`/works` 自动 refresh running sessions）

## 7. 关联文档

- `docs/design.md` — 主架构（chat 部分，未触动）
- `docs/api-mapping.md` — AGNO 端点表（sessions 部分将扩展）
- `docs/technical-debt.md` — 后续追加 works 相关技术债