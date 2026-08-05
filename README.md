# Agno Desktop

> **多实例、本地优先的 AGNO AgentOS 对话台** — 一个连接任意 AGNO 实例的可视化前端。

[![Tech](https://img.shields.io/badge/React-19-61dafb)](https://react.dev) [![Vite](https://img.shields.io/badge/Vite-8-646cff)](https://vitejs.dev) [![Tailwind](https://img.shields.io/badge/Tailwind-4-38bdf8)](https://tailwindcss.com) [![Tauri](https://img.shields.io/badge/Tauri-2-FFC131)](https://tauri.app) [![AGNO](https://img.shields.io/badge/AGNO-2.6.x-7c3aed)](https://docs.agno.com)

## 一句话定义

**打开应用 → 添加 AGNO 实例 → 选 agent → 聊天**，就能和任意 AGNO AgentOS 上的 agent 对话，看到完整的思考过程、工具调用、工具结果和引用来源。Web / 桌面两端一致，桌面端额外绕过浏览器 CORS。

![Chat](docs/screenshots/chat.png)

## 核心能力

| 能力 | 描述 |
|------|------|
| **多 AGNO 实例** | 同时管理多个实例（dev / staging / prod），一键切换 |
| **每实例独立 `user_id`** | dev / staging / prod 的 session、memory 互不串扰 |
| **Agent 选择** | 列出当前实例的所有 agent，每个 agent 独立 session |
| **流式对话** | SSE 实时渲染 token；思考、工具调用、结果分级展示 |
| **长会话不卡** | 1000+ 条消息的 session 流畅滚动，新消息自动跟底 |
| **Sub-agent 抽屉** | Team / multi-agent 场景下点 sub message 弹出独立面板 |
| **HITL 审批** | agent 暂停时弹窗，提交工具执行结果后继续 |
| **工具调用可视化** | 折叠卡片显示工具名 / 输入 / 状态 / 时长 / 结果 |
| **Web Search 结果** | 自动识别 `web_search` 返回的列表，渲染为可点击链接卡片 |
| **Markdown + 代码高亮** | GitHub Dark 代码块、表格、引用、链接 |
| **Hash 深链** | `#message-<id>` 跳转到指定消息，滚动位置自动同步到 URL |
| **Session 管理** | 服务端 session 列表、搜索、重命名、删除 |
| **取消运行** | SSE 立即中断 + 服务端 cancel 兜底 |
| **桌面自动更新** | GitHub Releases 渠道，启动检测 + 一键安装 |
| **本地优先** | 所有数据本地存储，零遥测 |

## 快速开始

```bash
# 1. 安装依赖
bun install    # 或 npm install / pnpm install

# 2. 启动 dev server（浏览器模式）
bun run dev    # 默认 http://127.0.0.1:5173

# 3. 启动桌面端 dev（Tauri WKWebView）
bun run dev:desktop

# 4. 打开浏览器 / 应用
open http://127.0.0.1:5173   # 浏览器 dev

# 5. 添加实例
#    在「实例」页面，点击「添加实例」
#    填入 base URL（如 http://127.0.0.1:8000）
#    检测到 localhost 时建议用 /api 走 Vite 代理

# 6. 切换到「对话」页，选择 agent，开始聊天
```

### 连接到远程实例

如果你的 AGNO 实例在远程（公司部署），需要：

1. **确保 JWT token**：prod 模式需要 `Authorization: Bearer <token>`
2. **CORS 允许**：如果不能改服务端 CORS，可以部署一个反向代理（Nginx / Caddy）放到同源

### 🍎 macOS 桌面端首次启动（重要）

桌面 `.dmg` **未做 Apple 代码签名 / 公证**。首次启动会被 Gatekeeper 拦下，弹「无法打开，因为 Apple 无法检查其是否有害」或「文件已损坏」（取决于 macOS 版本）。三种解法任选其一：

```bash
# 方案 A：去 quarantine 属性（推荐，命令行一把过）
xattr -dr com.apple.quarantine "/Applications/Agno Desktop.app"
```

- **方案 B：右键 app → 打开 → 弹窗里再点「打开」**（一次性，记入 Gatekeeper 白名单）
- **方案 C：系统设置 → Privacy & Security → 滚到底点「Open Anyway」**

之后 macOS 会记住该 app 的信任状态，不再弹窗。

### ⚠️ CORS 问题（必看）

AGNO 服务端默认只允许 `https://app.agno.com` 跨域。如果你的前端不是
部署在 `app.agno.com`，浏览器会拦截请求：

```
Access to fetch at 'http://127.0.0.1:8000/sessions?limit=100' from origin
'http://127.0.0.1:5174' has been blocked by CORS policy: No
'Access-Control-Allow-Origin' header is present on the requested resource.
```

应用会**自动识别 CORS 错误**并在 UI 里给出明确指引（含「一键改用 /api 代理」按钮），不用再翻日志。

**本地开发（推荐）**：用 Vite 代理绕过 CORS。

```bash
bun run dev                                 # 默认代理到 127.0.0.1:8000
AGNO_PROXY_TARGET=http://192.168.1.100:8000 bun run dev   # 远程内网
```

添加实例时输入 `http://127.0.0.1:8000` 然后点 **"改用 /api"**，或直接输 `/api`。

**桌面端**：Tauri WKWebView 不受浏览器 CORS 限制，可直接填 `http://192.168.x.x:8000` 等远程地址。

**远程实例 + 浏览器**：必须让后端放行你的 origin。三种方案：

1. **同源部署** — 把 Agno Desktop 部署到和 AGNO 实例相同的域名下
2. **公司内网** — 让 AGNO 运维把你的 origin 加到 CORS 白名单
3. **反代** — Nginx / Caddy 上加一层反代透传

## 版本历史

完整变更见 [CHANGELOG.md](./CHANGELOG.md)。最近几个版本：

| 版本 | 日期 | 关键变更 |
|------|------|---------|
| 0.0.11 | 2026-08-05 | 长对话滚到边界 rubber-band 整页修复；README 重写 + macOS Gatekeeper 提示 |
| 0.0.10 | 2026-07-26 | 每实例独立 `user_id`，session 互相隔离；sidebar streaming 即时刷新 |
| 0.0.9  | 2026-07-23 | 消息虚拟化、Markdown 流式节流、Worker 代码高亮、hash 深链 |
| 0.0.8  | —        | Tauri 桌面壳首版（绕过 CORS，5.8 MB dmg） |

## 已知问题 / 限制

- **macOS 桌面端未签名 / 未公证** — 首次启动需 `xattr` 或右键 → 打开绕过 Gatekeeper（见上文）。
- **AGNO CORS 限制** — 服务端默认只允许 `app.agno.com`。本地浏览器 dev 必须用 `/api` 代理；桌面端直连不受此限制。
- **Markdown 代码块强制 `github-dark`** — 不跟随应用主题切换。
- **Memory UI 占位** — `MemoryPage` 只展示当前 `user_id`，记忆列表将在后续版本加入。
- **断线重连暂未启用** — `last_event_index` 已记录，触发逻辑待 AGNO `/resume` 端点稳定后接入。
- **macOS 仅 Apple Silicon** — 无 x86_64 产物。

## 自动更新

桌面端已集成自动更新，订阅 GitHub Releases 渠道。启动 5 秒后自动检查（可在设置页关闭），命中新版本时右下角 toast 提示，点「立即更新」即下载并安装。错误（网络 / 签名失败）会弹错误 toast + 重试按钮。

- macOS：自动重启应用并应用新 binary
- Windows：弹安装器静默安装后用户手动重启

### 浏览器 / 移动端行为

- 浏览器 dev：updater 钩子完全 no-op
- 移动端：走应用商店更新

### 发布流程（CI 自动）

推 tag 即自动出全平台产物：

#### 一次性配置

去 [Settings → Secrets and variables → Actions](https://github.com/yxc023/agno-desktop/settings/secrets/actions) 添加：

| Secret 名 | 怎么拿 |
|-----------|--------|
| `TAURI_SIGNING_PRIVATE_KEY` | `cat ~/.tauri/keys/agno-desktop.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `cat ~/.tauri/keys/agno-desktop.key.password` |

私钥生成：

```bash
cargo install tauri-cli --version "^2.0" --locked
tauri signer generate -w ~/.tauri/keys/agno-desktop.key
```

#### 每次发版

```bash
# 1. bump version（三个文件必须保持一致）
#    package.json / src-tauri/Cargo.toml / src-tauri/tauri.conf.json

# 2. commit + push
git commit -am "chore: bump version to 0.0.X"
git push

# 3. 打 tag → 自动触发 workflow
git tag v0.0.X
git push --tags

# 4. 等待 15-25 分钟，GitHub → Actions 看进度
#    完成后出现 draft release：https://github.com/yxc023/agno-desktop/releases/tag/v0.0.X

# 5. 审核 → 点 "Publish release"
```

#### 产物矩阵

| 平台 | 格式 | 备注 |
|------|------|------|
| macOS | `*.dmg` | Apple Silicon only，未签名 / 未公证 |
| Windows | `*.msi` | x86_64 |

> Linux 暂未打包——先聚焦 macOS / Windows。

## 文档

- [设计稿](./docs/design.md) — 架构、数据流、UI 设计
- [API 映射表](./docs/api-mapping.md) — AGNO OpenAPI ↔ 前端实现
- [CHANGELOG.md](./CHANGELOG.md) — 完整版本变更日志

## 致谢

- [AGNO](https://docs.agno.com) — Agent SDK + AgentOS Runtime
- [shadcn/ui](https://ui.shadcn.com) — 组件设计灵感
- [OpenCode](https://github.com/anomalyco/opencode) / [Cursor](https://cursor.com) / [Claude Code](https://claude.com/product/claude-code) — agent UI 设计参考

---

v0.0.11 · 长对话滚动修复 + README 重写