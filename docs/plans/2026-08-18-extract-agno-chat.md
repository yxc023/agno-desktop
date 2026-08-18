# Extract agno-chat Component Package — Design

Date: 2026-08-18
Status: Approved
Target version: 0.0.13

## Goal

将对话界面（`<ChatPanel>`、消息气泡、工具调用、HITL、子代理面板、会话侧栏）和支撑它的 AGNO 客户端 / chat runner / SSE 解析从 `agno-desktop` 抽到独立 workspace 包 `agno-chat`。目的是让"对接 AGNO AgentOS 的前端项目"可以零成本复用这一整套；`agno-desktop` 退化为薄壳（应用层只管多实例、路由、设置、Updater、Tauri shell）。

后续可在此包上扩展其他 agent 后端适配（OpenCode / 自研等），但**本设计仅覆盖 AGNO**。

## Scope

**In (v1)**

- AGNO 协议适配层：`AgnoClient`、`agno-types`、`sse-parser`、`chat-runner`、`chat-buffer`、各种纯逻辑 util
- 聊天 UI：`ChatPanel` 及子组件、`MessageBubble`、`ToolCallCard` / `ToolCallGroup`、`ReasoningBlock`、`ApprovalDialog`、`MessageInput`、`MessageContent`、`VirtualMessageList`、`AgentPicker`、`ContextProgressBar`、`FilePreviewPanel`、`SubAgentSidePanel`、`StreamingBadge`
- Markdown 渲染：`Markdown`、`CodeBlock`、`MarkdownStream`
- 会话管理 UI + store：侧栏、列表、搜索、改名、删除、分页
- 包内 UI primitives：button / dialog / dropdown-menu / input / label / popover / resizable / scroll-area / select / separator / skeleton / tabs / tooltip / badge
- 包内 zustand store：包版 `chat-store`、`sessions-store`（按 `agentId` 隔离，不再读 `useInstancesStore`）
- 公开 API：`<ChatPanel>` + 必要类型 + `AgnoClient` + `resolveToolRender`
- 主题：CSS 变量覆盖（accent / radius 等），默认走 Tailwind v4 + 应用层编译
- Workspace 骨架 + 子包构建（vite lib mode + tsc declaration）
- 测试迁移 + 包内新增组件测试

**Out (v1)**

- 通用化到非 AGNO 后端（OpenCode / 自研）——后续再做
- 应用层剩余的 stores（instances / settings / ui-store 的应用层部分 / updater）改造
- Tauri shell 抽离（Tauri 专属，不属于聊天组件）
- `UserIdSetupDialog` 抽离（属于 instance 设置流程）
- 跨重启的 session / message 持久化（当前 chat-store 不持久化，保持不变）
- 多 ChatPanel 并排（产品暂无需求，key remount 方案保留未来扩展空间）

## Architecture

```
┌─────────────────── 应用层 (agno-desktop) ────────────────────┐
│  实例管理(多 AGNO)  │  Settings / Memory / Updater          │
│  路由 / AppShell │  Tauri shell (desktop only)            │
└───────────────────────────────────────────────────────────────┘
                              │
                              │ <ChatPanel baseUrl agentId />
                              ▼
┌─────────────────── 包层 (packages/agno-chat) ─────────────────┐
│  <ChatPanel> (含会话侧栏 / 消息流 / 输入 / HITL) │
│  ├─ AGNO 客户端 (http + SSE) │
│  ├─ ChatRunner (SSE event → message parts reducer)          │
│  ├─ 会话管理 store (按 agentId 隔离)                          │
│  └─ 消息 /工具调用 / 推理 / 上下文进度展示 │
└───────────────────────────────────────────────────────────────┘
```

**关键边界**

- 包**不**关心"实例列表 / 哪个 instance 是 active"——这属于应用层（多 AGNO 实例是 agno-desktop 的特性，不是 AGNO 协议本身的关注点）
- 包**接受**一个已构造好的 `AgnoClient` 实例或 `{ baseUrl, headers?, token? }` 配置，让应用层控制鉴权
- 包**自带** Tailwind v4 + CSS 变量主题；消费方 import `agno-chat/styles.css` 拿默认主题，或通过 `theme` prop 覆盖变量
- 应用层切 instance 时用 `<ChatPanel key={`${instId}-${agentId}`}>` 强制 remount——包内 store 永远只有一个 agent 的状态，实现最简
- `AgnoClient` 在包内**每次新建**（不缓存）。baseUrl/token 变就重建

## Monorepo Structure

```
agno-desktop/
├── package.json              # 根 workspace
├── tsconfig.json             # references → app + agno-chat
├── tsconfig.app.json         # 应用层
├── vite.config.ts            # 应用层 dev/build，alias → 包源
├── src/                      # 应用层代码（缩到 ~30%）
├── src-tauri/                # 不动
├── docs/                     # 不动
├── tests/                    # 应用层测试
├── scripts/                  # 不动
└── packages/
    └── agno-chat/
        ├── package.json      # name: "agno-chat", exports字段
        ├── tsconfig.json     # composite, declaration: true
        ├── vite.config.ts    # lib mode，rollup external 化 deps
        ├── README.md         # 消费者文档
        ├── src/
        │   ├── index.ts      # public exports
        │   ├── ChatPanel.tsx
        │   ├── components/   # 从 src/components/chat 搬来
        │   ├── markdown/     # 从 src/components/markdown 搬来
        │   ├── ui/           # 从 src/components/ui 选搬
        │   ├── hooks/        # 未来扩展点（v1 仅内部用）
        │   ├── stores/       # chat-store / sessions-store（包内版）
        │   ├── lib/          # 纯逻辑
        │   ├── styles.css    # Tailwind v4 入口 + 主题变量
        │   └── types.ts      # 公共类型
        └── tests/            # 包内测试
```

**Workspace 配置**（根 `package.json`）

```json
{
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "typecheck": "tsc -b --noEmit",
    "lint": "oxlint",
    "test": "bun run scripts/test.ts",
    "test:chat": "cd packages/agno-chat && bun test"
  }
}
```

**子包 `peerDependencies`**：`react` / `react-dom` 写 `^19.2.0`，避免双 React 副本（Radix portal 跨 React 树会失效）。

**子包 `dependencies`**：Radix 全家、zustand、react-markdown、remark-*、rehype-*、highlight.js、@tanstack/react-virtual、react-resizable-panels、lucide-react、cva、clsx、tailwind-merge——应用层 `package.json` 删掉这些。

## Public API

```ts
// packages/agno-chat/src/index.ts
export { ChatPanel } from "./ChatPanel";

export type {
  ChatPanelProps,
  AgnoClientConfig,
  AgnoChatTheme,
  ChatMessage,
  MessagePart,
  AgentSummary,
  ChatPanelSlots,
} from "./types";

export { AgnoClient } from "./lib/agno-client";
export { resolveToolRender } from "./lib/tool-render-utils";
```

**核心 — `<ChatPanel>` props**

```ts
interface ChatPanelProps {
  // 必需（任选其一提供 agent 列表）
  baseUrl: string;
  agentId?: string;
  agents?: AgentSummary[];        // 静态传入，省一次 listAgents
  onAgentsChange?: (a: AgentSummary[]) => void;

  // 鉴权
  auth?: { token?: string; headers?: Record<string, string> };

  // 主题 / 行为（全部 optional）
  theme?: AgnoChatTheme;          // 覆盖 CSS 变量
  showSessionList?: boolean;      // default true
  showReasoning?: boolean;        // default true
  showContextProgress?: boolean;  // default true
  briefToolCalls?: boolean;       // default false

  // 回调
  onError?: (err: Error) => void;
  onSessionChange?: (id: string | null) => void;

  // 子区域覆盖
  slots?: ChatPanelSlots;
}
```

**故意不暴露**（包内细节，下个版本随时可改）：`useChatStore` / `useSessionsStore` / `ChatRunner` / mutator。

## Data Flow

```
AGNO SSE stream
  → sse-parser.ts (包内)          bytes → typed events
  → chat-runner.ts (包内)         events → message parts via reducer
  → chat-store.ts (包内)          parts → zustand state
  → ChatPanel / MessageBubble (包内)

listSessions / listAgents / getSession / getSessionRuns (应用层触发 listAgents)
  → AgnoClient (包内)
  → sessions-store (包内)         list → zustand state
  → SessionList (包内)
```

## Data Model 变更

**当前** `sessions-store.byInstance: Record<instanceId, AgSessionSummary[]>`
**包版** `sessions-store.byAgent: Record<agentId, AgSessionSummary[]>`

切 instance 在应用层触发 `<ChatPanel key={...}>` remount → 包内 store 整个重建 → 自然无 namespace 串味风险。

`chat-store.messagesBySession` 保留，但 key 简化为 `agentId + ":" + sessionId`（不带 instanceId 前缀，因为包内看不到 instance）。

## Component Reorg

| 当前 | 处理 |
|---|---|
| `src/components/chat/*` (13 files) | **搬入包** `packages/agno-chat/src/components/chat/` |
| `src/components/markdown/*` | **搬入包** `packages/agno-chat/src/components/markdown/` |
| `src/components/sessions/*` | **搬入包** `packages/agno-chat/src/components/sessions/` |
| `src/components/ui/{button,dialog,dropdown-menu,input,label,popover,resizable,scroll-area,select,separator,skeleton,tabs,tooltip,badge}.tsx` | **搬入包** `packages/agno-chat/src/ui/` |
| `src/components/ui/{switch,card}.tsx` | **留在应用层**（instances / settings 用） |
| `src/components/instances/*` | **留在应用层** |
| `src/components/layout/*` | **留在应用层** |
| `src/components/common/*` | **留在应用层** |

## Lib Reorg

| 当前 | 处理 |
|---|---|
| `agno-client.ts` / `agno-types.ts` / `sse-parser.ts` / `chat-runner.ts` / `message-types*.ts` / `chat-buffer.ts` / `paced-value.ts` / `auto-scroll-controller.ts` / `agent-name.ts` / `preview-kind.ts` / `model-context-windows.ts` / `estimate-tokens.ts` / `strip-think-tags.ts` / `highlight-client.ts` / `highlight.worker.ts` / `ime-composing.ts` / `message-verbosity.ts` / `tool-render-utils.ts` | **搬入包** |
| `tauri.ts` / `tauri-fetch.ts` / `updater.ts` / `file-fetcher.ts` / `open-external-url.ts` | **留在应用层** |
| `storage.ts` | 留在应用层；包内 store 改用 `zustand/persist` 内部持久化（**不**调用 `loadJSON/saveJSON`） |
| `utils.ts`（`cn` / `generateId` / `format*` / `debounce`） | **搬入包** `packages/agno-chat/src/lib/utils.ts` |

## Stores Reorg

| 当前 | 处理 |
|---|---|
| `chat-store.ts` (2201 行) | **搬入包 + 参数化**：去掉 `useInstancesStore.getState()` 调用，改为 `_client: AgnoClient` / `_agentId` 字段；setter 在 mount 时由 `<ChatPanel>` 调用 |
| `sessions-store.ts` (353 行) | 同上 |
| `instances-store.ts` | **留在应用层** |
| `settings-store.ts` / `updater-store.ts` | **留在应用层** |
| `ui-store.ts` (340 行) | **拆分**：聊天相关字段（sessions list open / file preview / resize width）留在应用层（这些是 layout-level，不该进包）；聊天内部状态（如 input focused）进包 |

## Pages Reorg

- `pages/ChatPage.tsx`（当前 ~500 行）：**大幅简化**——`useActiveInstance()` 拿 baseUrl/token，`useActiveAgents()` 拿 agents，渲染 `<ChatPanel baseUrl auth={...} agents={...}>`。预计<100 行
- 其他 pages 不动

## Build / Config

### 根 `tsconfig.json`

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./packages/agno-chat/tsconfig.json" }
  ]
}
```

### 子包 `vite.config.ts`（lib mode）

```ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: [
        "react", "react-dom",
        /^@radix-ui\//,
        "zustand",
        "react-markdown", "remark-gfm", "remark-breaks",
        "rehype-highlight", "rehype-raw",
        "highlight.js",
        "@tanstack/react-virtual",
        "react-resizable-panels",
        "lucide-react",
        "class-variance-authority",
        "clsx",
        "tailwind-merge",
      ],
      output: { dir: "dist", sourcemap: true },
    },
    sourcemap: true,
    target: "es2022",
  },
});
```

### 应用层 `vite.config.ts`

```ts
resolve: {
  alias: {
    "agno-chat": fileURLToPath(
      new URL("./packages/agno-chat/src/index.ts", import.meta.url)
    ),
  },
},
optimizeDeps: { exclude: ["agno-chat"] },
```

### Tailwind CSS 入口

应用层 `src/index.css`：

```css
@import "tailwindcss";
@source "../packages/agno-chat/src/**/*.{ts,tsx}";
/* 原有 :root 变量不动 */
```

子包 `src/styles.css`：

```css
@source "./**/*.{ts,tsx}";
@import "tailwindcss";
@theme {
  --color-accent: var(--agno-accent, hsl(240 5.9% 50%));
  --color-accent-foreground: var(--agno-accent-fg, white);
  --radius-agno: var(--agno-radius, 0.5rem);
}
@layer base {
  :root {
    --agno-accent: hsl(240 5.9% 50%);
    --agno-accent-fg: white;
    --agno-radius: 0.5rem;
  }
}
```

消费方：主入口 `import "agno-chat/styles.css"`。

## Performance 考量

**风险评估**：

- 切 instance 时 `<ChatPanel key={...}>` 强制 remount：React 卸载/重建 ~100-200ms，被网络耗时（listAgents + listSessions + loadHistory 三连通常 100-500ms）淹没，用户感知不到
- `AgnoClient` 每次新建：无状态对象，构造忽略不计
- 包内 store 不导出：外部 re-render 不会触发包内 selector 抖动——比当前更稳
- 消息虚拟化、流式节流、auto-scroll 行为不变

**真正风险**：依赖双副本（Radix / react-markdown / highlight.js / zustand 等）。如果应用层和包都 `dependencies` 声明，bun 装两份 → bundle 体积翻倍，且 Radix portal / tooltip / dialog 跨 React 实例**失效**。

**必须做**：

1. 应用层 `package.json` 删掉 Radix / react-markdown / highlight.js / zustand / react-resizable / @tanstack/react-virtual / lucide / tailwind-merge / clsx / cva / sonner 等包内已声明的 deps
2. `react` / `react-dom` 改为包 `peerDependencies`
3. Tailwind v4 由**应用层编译**扫包源（`@source` directive），子包不重新跑 Tailwind
4. dev 用 `optimizeDeps.exclude: ["agno-chat"]` + alias 直接读源
5. 应用层 slot 渲染函数 `useCallback` / 父组件 `React.memo`
6. **包内 store 不导出**——外部 re-render 触发不了包内 selector 抖动

## Testing

**包内测试** `packages/agno-chat/tests/`（镜像 `src/lib` 命名）：

- `lib/sse-parser.test.ts` — 迁移
- `lib/chat-runner.test.ts` — 迁移
- `lib/chat-buffer.test.ts` — 迁移
- `lib/paced-value.test.ts` — 迁移
- `lib/tool-render-utils.test.ts` — 迁移
- `lib/strip-think-tags.test.ts` — 迁移
- `lib/preview-kind.test.ts` — 迁移
- `lib/auto-scroll-controller.test.ts` — 迁移
- `lib/agent-name.test.ts` — 迁移
- `lib/model-context-windows.test.ts` — 迁移
- `stores/chat-store.test.ts` — 迁移，mock 改 `AgnoClient`（原来是 mock `useInstancesStore`）
- `components/ChatPanel.test.tsx` — 新增：happy path 渲染
- `components/MessageBubble.test.tsx` — 新增：各种 part
- `components/ApprovalDialog.test.tsx` — 新增：HITL 流程
- `components/ToolCallCard.test.tsx` — 新增：展开/折叠

**应用层测试** `tests/`：只保留 instance-form-dialog / updater / settings / ui-store 的应用层部分测试。

**测试命令**：

- 根 `bun run test` — 跑所有
- `bun run test:chat` — 只跑包内

## Migration Phases

### Phase 0 — Workspace 骨架（不动业务代码）

1. 根 `package.json` 加 `"workspaces": ["packages/*"]`
2. 创建 `packages/agno-chat/{package.json, tsconfig.json, vite.config.ts}` 空壳
3. 根 `tsconfig.json` 改 references
4. `bun install` 验证 workspace
5. ✅ Checkpoint：`typecheck` / `build` / `test` 全过

### Phase 1 — 平移纯逻辑 lib（低风险）

1. 复制 `src/lib/` 下所有纯函数到 `packages/agno-chat/src/lib/`
2. 复制对应测试到 `packages/agno-chat/tests/lib/`
3. 应用层 `src/lib/` 改为 re-export shim（`export * from "agno-chat/lib/..."`）
4. ✅ Checkpoint：所有测试通过

### Phase 2 — 组件平移

1. 复制 `src/components/{chat,markdown,sessions}` 到 `packages/agno-chat/src/components/`
2. 复制需要的 `src/components/ui/*` 到 `packages/agno-chat/src/ui/`
3. 应用层 import 改为 `from "agno-chat"`（或子路径）
4. ✅ Checkpoint：`bun run dev` 跑起来，UI 一致

### Phase 3 — Store 重构（高风险，分 3 步）

**Step 3a — 平移**：

1. 包内建 `chat-store.ts` v0：复制现有 store，**保留** `useInstancesStore.getState()` 调用（最小 diff）
2. 应用层 `chat-store` 改用包内版本
3. ✅ 测试通过

**Step 3b — 参数化**：

1. 包内 store v1：把 `useInstancesStore` 依赖参数化为 `_client: AgnoClient` / `_agentId` 字段，外部 setter 注入
2. 应用层在挂载 `<ChatPanel>` 前 `useChatStore.getState().setContext({ client, agentId })`
3. ✅ 测试通过

**Step 3c — sessions-store 同样处理**

1. ✅ 手动测多 instance 切换

### Phase 4 — ChatPage 简化

1. `pages/ChatPage.tsx` 简化为：读 active instance + 选中的 agent → 渲染 `<ChatPanel baseUrl token agents=...>`
2. ✅ Checkpoint：跑通真实对话流（SSE / HITL / 子代理）

### Phase 5 — 收尾

1. 删除应用层 `src/lib/` 下的 re-export shim
2. 移除应用层 `package.json` 已迁出的 deps
3. 更新 `AGENTS.md` / `docs/design.md` / `README.md`
4. `CHANGELOG.md` 加 0.0.13 条目（Added / Changed）
5. ✅ Checkpoint：typecheck / lint / test / build 全过；dev HMR 正常；Tauri desktop 构建正常

## Risks

| 风险 | 缓解 |
|---|---|
| chat-store 2200 行一次性搬会回归 | Phase 3 拆 3 步：平移 → 参数化 → 清理 |
| 应用层 import 改动面太大 | Phase 1/2 用 re-export shim，Phase 5 再清 |
| `useChatStore` 被应用层其他 store 引用 | Phase 3 之前先 grep + 列引用面；外部订阅改为传 props |
| 包 CSS 与应用层 CSS 冲突 | Tailwind 4 `@source` 只扫本包；应用层 `@source "../packages/agno-chat/src/**/*.{ts,tsx}"` |
| `tsconfig` composite 踩坑 | 根 references + 子包 `composite: true`；先空壳跑通再填代码 |
| Tauri 桌面构建破坏 | Phase 5 之前每次 phase 后跑 `bun run build:desktop`（慢但兜底）|
| 双 React 实例导致 Radix portal 失效 | react / react-dom 改 `peerDependencies`，应用层不卸载 |
| 依赖双副本 | 应用层删干净重复 deps；lockfile 验证 |

## 文档更新

- `AGENTS.md`：加 "Subpackage: agno-chat" 一节
- `docs/design.md`：加架构图说明 monorepo 边界
- `packages/agno-chat/README.md`：消费者文档（props / theme / slots / 升级指南）
- `CHANGELOG.md`：v0.0.13 条目