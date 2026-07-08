# Agno Desktop

> **多实例、本地优先的 AGNO AgentOS 对话台** — 一个连接任意 AGNO 实例的可视化前端。

[![Tech](https://img.shields.io/badge/React-19-61dafb)](https://react.dev) [![Vite](https://img.shields.io/badge/Vite-8-646cff)](https://vitejs.dev) [![Tailwind](https://img.shields.io/badge/Tailwind-4-38bdf8)](https://tailwindcss.com) [![Tauri](https://img.shields.io/badge/Tauri-2-FFC131)](https://tauri.app) [![AGNO](https://img.shields.io/badge/AGNO-2.6.x-7c3aed)](https://docs.agno.com)

## 一句话定义

**打开浏览器 → 添加 AGNO 实例 → 选 agent → 聊天**，就能和任意 AGNO AgentOS 上的 agent 对话，看到完整的思考过程、工具调用、工具结果和引用来源。

![Chat](docs/screenshots/chat.png)

## 核心能力

| 能力 | 描述 |
|------|------|
| **多 AGNO 实例** | 同时管理多个实例（dev / staging / prod），一键切换 |
| **Agent 选择** | 列出当前实例的所有 agent，每个 agent 独立 session |
| **流式对话** | SSE 实时渲染 token；思考、工具调用、结果分级展示 |
| **工具调用可视化** | 折叠卡片显示工具名 / 输入 / 状态 / 时长 / 结果 |
| **Web Search 结果** | 自动识别 `web_search` 返回的列表，渲染为可点击链接卡片 |
| **Markdown + 代码高亮** | GitHub Dark 代码块、表格、引用、链接 |
| **Session 管理** | 服务端 session 列表、搜索、重命名、删除 |
| **取消运行** | SSE AbortController 立即中断 + 服务端 cancel 兜底 |
| **HITL 审批** | agent 暂停时弹窗，提交工具执行结果后继续 |
| **断线重连** | SSE 事件索引恢复（AGNO `/resume` 端点） |
| **本地优先** | 所有数据 localStorage，零遥测 |
| **Vite 代理** | `/api/*` 代理到 AGNO，绕过 CORS |

## 快速开始

```bash
# 1. 安装依赖
bun install    # 或 npm install / pnpm install

# 2. 启动 dev server
bun run dev    # 默认 http://localhost:5173

# 3. 打开浏览器
open http://localhost:5173

# 4. 添加实例
# 在「实例」页面，点击「添加实例」
# 填入 base URL（如 http://127.0.0.1:8000）
# 检测到 localhost 时建议用 /api 走 Vite 代理

# 5. 切换到「对话」页，选择 agent，开始聊天
```

### 连接到远程实例

如果你的 AGNO 实例在远程（公司部署），需要：

1. **确保 JWT token**：prod 模式需要 `Authorization: Bearer <token>`
2. **CORS 允许**：如果不能改服务端 CORS，可以部署一个反向代理（Nginx / Caddy）放到同源

### ⚠️ CORS 问题（必看）

AGNO 服务端**默认只允许 `https://app.agno.com` 跨域**。如果你的前端不是
部署在 `app.agno.com`，直接请求会被浏览器 CORS 拦截，错误类似：

```
Access to fetch at 'http://127.0.0.1:8000/sessions?limit=100' from origin
'http://localhost:5174' has been blocked by CORS policy: No
'Access-Control-Allow-Origin' header is present on the requested resource.
```

应用会**自动识别 CORS 错误**并在 UI 里给出明确指引（不用再翻日志）。

**本地开发（推荐）**：用 Vite 代理绕过 CORS。

```bash
# 默认代理到 127.0.0.1:8000
bun run dev

# 远程内网 AGNO
AGNO_PROXY_TARGET=http://192.168.1.100:8000 bun run dev
```

添加实例时输入 `http://127.0.0.1:8000` 然后点 **"改用 /api"**，或直接输 `/api`。

**远程实例**：必须让后端放行你的 origin。三种方案：

1. **同源部署** — 把 Agno Desktop 部署到和 AGNO 实例相同的域名下
2. **公司内网** — 让 AGNO 运维把你的 origin 加到 CORS 白名单
3. **反代** — Nginx / Caddy 上加一层反代透传

### 自定义代理目标

默认 Vite 代理到 `http://127.0.0.1:8000`。要切换：

```bash
AGNO_PROXY_TARGET=http://192.168.1.100:8000 bun run dev
```

## 技术栈

| 维度 | 选型 |
|------|------|
| 框架 | React 19 + Vite 8 + TypeScript 6 |
| 样式 | Tailwind CSS 4 + CSS Variables + shadcn 风格组件 |
| 状态 | Zustand 5（4 个 store） |
| 路由 | React Router 7 |
| UI 组件 | 自建 shadcn 风格 + Radix UI primitives |
| Markdown | react-markdown + remark-gfm + remark-breaks + rehype-highlight |
| 代码高亮 | highlight.js（github-dark 主题） |
| 图标 | lucide-react |
| SSE | 原生 fetch + ReadableStream 解析 |
| 布局 | react-resizable-panels |
| 通知 | sonner |
| 持久化 | localStorage（无后端） |
| 包管理 | bun（也支持 npm/pnpm/yarn） |

## 项目结构

```
agno-desktop/
├── src/
│   ├── main.tsx                       # 入口
│   ├── App.tsx                        # 路由
│   ├── index.css                      # Tailwind + CSS Variables
│   ├── components/
│   │   ├── ui/                        # shadcn 风格基础组件
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── input.tsx
│   │   │   ├── select.tsx
│   │   │   ├── tooltip.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── scroll-area.tsx
│   │   │   ├── separator.tsx
│   │   │   ├── switch.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── popover.tsx
│   │   │   ├── label.tsx
│   │   │   ├── skeleton.tsx
│   │   │   └── resizable.tsx
│   │   ├── layout/
│   │   │   └── AppShell.tsx           # 主壳（左侧导航 + Outlet）
│   │   ├── instances/
│   │   │   ├── InstanceFormDialog.tsx # 添加/编辑实例对话框
│   │   │   └── InstancesPanel.tsx     # 实例状态侧边面板
│   │   ├── sessions/
│   │   │   └── SessionList.tsx        # 会话列表（搜索/重命名/删除）
│   │   ├── chat/
│   │   │   ├── ChatPanel.tsx          # 对话主面板
│   │   │   ├── MessageBubble.tsx      # 消息气泡（按 part 渲染）
│   │   │   ├── MessageInput.tsx       # 输入框（支持文件）
│   │   │   ├── ReasoningBlock.tsx     # 思考过程（可折叠）
│   │   │   ├── ToolCallCard.tsx       # 工具调用卡片
│   │   │   └── ApprovalDialog.tsx     # HITL 审批弹窗
│   │   ├── markdown/
│   │   │   ├── Markdown.tsx           # Markdown 渲染
│   │   │   └── CodeBlock.tsx          # 代码块
│   │   └── common/
│   │       └── Logo.tsx
│   ├── lib/
│   │   ├── agno-client.ts             # AGNO HTTP 客户端
│   │   ├── agno-types.ts              # AGNO API 类型
│   │   ├── sse-parser.ts              # SSE 解析器
│   │   ├── chat-runner.ts             # Chat 事件归约器
│   │   ├── message-types.ts           # 前端消息类型
│   │   ├── message-types-helpers.ts
│   │   ├── storage.ts                 # localStorage 工具
│   │   └── utils.ts                   # cn/format/debounce/copy
│   ├── stores/
│   │   ├── instances-store.ts         # AGNO 实例管理
│   │   ├── sessions-store.ts          # Session 列表
│   │   ├── chat-store.ts              # 消息 + runner
│   │   ├── settings-store.ts          # 应用设置
│   │   └── ui-store.ts                # 临时 UI 状态
│   ├── pages/
│   │   ├── ChatPage.tsx
│   │   ├── InstancesPage.tsx
│   │   ├── MemoryPage.tsx
│   │   ├── SettingsPage.tsx
│   │   ├── WelcomeScreen.tsx
│   │   └── NotFoundPage.tsx
│   ├── hooks/                          # (预留)
│   └── types/                          # (预留)
├── docs/
│   ├── design.md                       # 详细设计稿
│   ├── api-mapping.md                  # AGNO API ↔ 前端 UI 映射
│   └── screenshots/                    # 截图
├── public/
├── vite.config.ts                      # Vite 配置（含 /api 代理）
├── tailwind.config.js                  # (v4 用 CSS-first，无此文件)
└── package.json
```

## 路线图

| 版本 | 状态 | 范围 |
|------|------|------|
| v0.1 | ✅ 完成 | 聊天核心：多实例、SSE 流式、工具调用、Markdown、Session 管理 |
| v0.2 | 🚧 计划 | Memory 浏览、Knowledge 搜索、Trace 查看 |
| v1.0 | 📋 计划 | Approval 完整流、CRUD agents、Metrics、Settings 增强 |
| v2.0 | ✅ 完成 | Tauri 桌面壳（CORS 旁路、5.8 MB dmg），原生窗口 |

## 已知问题 / 限制

- **CORS 限制**：AGNO 服务端默认只允许 `app.agno.com` 跨域。本地实例必须用 `/api` 代理
- **背景色硬编码**：Markdown 代码块强制用 `github-dark`（不受主题切换影响）
- **没做 Memory UI**：v0.1 仅占位页，实际接口在 `agno-client.ts` 已实现
- **Approval 系统**：Run 级别 HITL 完整支持；Approval 端点列表未在 UI 暴露
- **断线重连**：UI 已记录 `last_event_index`，但 resume 触发逻辑未接

## 文档

- [设计稿](./docs/design.md) — 整体架构、UI 设计、数据流
- [API 映射表](./docs/api-mapping.md) — AGNO OpenAPI ↔ 前端实现

## 致谢

- [AGNO](https://docs.agno.com) — Agent SDK + AgentOS Runtime
- [shadcn/ui](https://ui.shadcn.com) — 组件设计灵感
- [Cursor](https://cursor.com) / [Claude Code](https://claude.com/product/claude-code) — agent UI 设计参考

---

v0.1 · 对话从 AGNO 服务端拉取，本地仅缓存实例配置
