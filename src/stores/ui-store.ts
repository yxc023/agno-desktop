/**
 * UI store: 临时 UI 状态（对话框、面板展开等）
 */

import { create } from "zustand";
import type { PreviewKind } from "@/lib/preview-kind";

/** 上限：sub-agent 面板栈的最大深度（含根）。超过后 push 直接 no-op。 */
const MAX_PANEL_STACK_DEPTH = 8;

/** 单个预览 tab 的状态（用于 file-preview-panel）。 */
export interface FilePreviewTab {
  id: string;
  sessionId: string;
  url: string;
  title: string;
  kind: PreviewKind;
  state: "loading" | "loaded" | "error";
  content?: string;
  mime?: string;
  error?: string;
  createdAt: number;
}

interface UIState {
  /** 添加实例对话框 */
  showAddInstance: boolean;
  setShowAddInstance: (v: boolean) => void;

  /** 命令面板 */
  commandOpen: boolean;
  setCommandOpen: (v: boolean) => void;

  /** 当前活跃的 approval/pending HITL */
  pendingApproval: null | {
    runId: string;
    agentId: string;
    sessionId?: string;
    toolCalls: Array<{
      tool_call_id: string;
      tool_name: string;
      tool_args: any;
    }>;
  };
  setPendingApproval: (
    v: UIState["pendingApproval"]
  ) => void;

  /** 实例设置抽屉 */
  instanceSettingsOpen: boolean;
  setInstanceSettingsOpen: (v: boolean) => void;

  /**
   * ChatPage 右侧 InstancesPanel 是否展开。
   * 触发器在左侧 AppShell 的 instance 卡片右上角（"更多实例信息"图标）。
   * 默认收起，避免常驻占用横向空间。
   */
  instancesPanelOpen: boolean;
  setInstancesPanelOpen: (v: boolean) => void;
  toggleInstancesPanel: () => void;

  /**
   * Sub-agent 详情面板
   *
   * 用法：在主流程的 MessageBubble 里点击 sub-agent chip →
   *   openSubAgentPanel(messageId) → 右侧抽屉打开，显示该 sub 完整内容
   * 支持嵌套导航（sub-of-sub）：在面板内点击更深 sub 的 marker 触发 pushSubAgentPanel
   * 想关闭时调 closeSubAgentPanel() / popSubAgentPanel()
   */
  subAgentPanel: {
    /** 一条 breadcrumb 栈：根 sub 在 [0]，当前选中在末尾 */
    stack: Array<{ sessionId: string; subMessageId: string }>;
  };
  openSubAgentPanel: (sessionId: string, subMessageId: string) => void;
  pushSubAgentPanel: (sessionId: string, subMessageId: string) => void;
  popSubAgentPanel: () => void;
  closeSubAgentPanel: () => void;

  /**
   * File preview 侧栏（agent 回复里点 .md / 图片 / 代码链接打开）。
   *
   * - `filePreviewPanelOpen`：面板本身可见性，与 tab 列表互相独立 —
   *   关闭面板只藏 UI，tabs 仍在内存；下次打开恢复。
   * - `filePreviewTabs`：所有 tab。tabs 跨 session 保留，但渲染层只显示
   *   当前 session 的 tab（见 `useFileTabsForSession`）。
   * - `activeFileTabId`：当前选中的 tab id；null 表示"panel 开着但无 tab"。
   */
  filePreviewPanelOpen: boolean;
  filePreviewTabs: FilePreviewTab[];
  activeFileTabId: string | null;

  openFilePreviewPanel: () => void;
  closeFilePreviewPanel: () => void;
  toggleFilePreviewPanel: () => void;

  /**
   * 打开一个 URL 的预览：自动 show panel；按 (sessionId, url) 复用 tab；
   * 已有则重置 state=loading（重新抓），没有则新建。返回 tabId 给 caller
   * 用来 await 后续的 setTabLoaded / setTabError。
   */
  previewFile: (sessionId: string, url: string, kind: PreviewKind) => string;
  selectFileTab: (tabId: string) => void;
  closeFileTab: (tabId: string) => void;
  setTabLoaded: (tabId: string, content: string, mime?: string) => void;
  setTabError: (tabId: string, error: string) => void;
}

/**
 * 把 (sessionId, url) 映射成一个稳定 id。用一个轻量 hash（FNV-1a 32-bit），
 * 避免引入 crypto / node:crypto 的开销。hash 仅用于 React key / 查表，
 * 不参与任何安全判定。
 */
function makeTabId(sessionId: string, url: string): string {
  const input = `${sessionId}|${url}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // 转成 8 字符十六进制，足以避免本机常规 tab 数量下的冲突
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * 从 url 取最后的 path 段作为 tab 标题。无 path / 无 basename 时回落到
 * 完整 url（截断）。
 */
function deriveTabTitle(url: string): string {
  try {
    const noHash = url.split("#")[0];
    const noQuery = noHash.split("?")[0];
    const lastSlash = noQuery.lastIndexOf("/");
    const basename = lastSlash === -1 ? noQuery : noQuery.slice(lastSlash + 1);
    if (basename.length > 0) return basename;
  } catch {
    // ignore
  }
  return url.length > 60 ? url.slice(0, 57) + "…" : url;
}

export const useUIStore = create<UIState>((set, get) => ({
  showAddInstance: false,
  setShowAddInstance: (v) => set({ showAddInstance: v }),

  commandOpen: false,
  setCommandOpen: (v) => set({ commandOpen: v }),

  pendingApproval: null,
  setPendingApproval: (v) => set({ pendingApproval: v }),

  instanceSettingsOpen: false,
  setInstanceSettingsOpen: (v) => set({ instanceSettingsOpen: v }),

  instancesPanelOpen: false,
  setInstancesPanelOpen: (v) => set({ instancesPanelOpen: v }),
  toggleInstancesPanel: () =>
    set((s) => ({ instancesPanelOpen: !s.instancesPanelOpen })),

  subAgentPanel: { stack: [] },
  openSubAgentPanel: (sessionId, subMessageId) => {
    const cur = get().subAgentPanel;
    if (
      cur.stack.length === 1 &&
      cur.stack[0].subMessageId === subMessageId &&
      cur.stack[0].sessionId === sessionId
    ) {
      return;
    }
    set({
      subAgentPanel: {
        stack: [{ sessionId, subMessageId }],
      },
    });
  },
  pushSubAgentPanel: (sessionId, subMessageId) => {
    const cur = get().subAgentPanel;
    // 同样的 (sessionId, subMessageId) 已经栈内 → 跳过，避免面包屑里
    // 出现重复条目（连续点击同一个 sub-of-sub 不会堆栈）。
    if (
      cur.stack.some(
        (e) => e.sessionId === sessionId && e.subMessageId === subMessageId
      )
    ) {
      return;
    }
    // Cap stack depth — a runaway click loop (or pathological nested
    // sub-of-sub config) would otherwise grow the breadcrumb row
    // indefinitely; the deeper levels also can't actually be rendered
    // (max practical team depth is ~3 today).
    if (cur.stack.length >= MAX_PANEL_STACK_DEPTH) return;
    set({
      subAgentPanel: {
        stack: [...cur.stack, { sessionId, subMessageId }],
      },
    });
  },
  popSubAgentPanel: () => {
    const cur = get().subAgentPanel;
    if (cur.stack.length === 0) return;
    set({
      subAgentPanel: { stack: cur.stack.slice(0, -1) },
    });
  },
  closeSubAgentPanel: () => set({ subAgentPanel: { stack: [] } }),

  // ───────────────────── file preview panel ─────────────────────
  filePreviewPanelOpen: false,
  filePreviewTabs: [],
  activeFileTabId: null,

  openFilePreviewPanel: () => set({ filePreviewPanelOpen: true }),
  closeFilePreviewPanel: () => set({ filePreviewPanelOpen: false }),
  toggleFilePreviewPanel: () =>
    set((s) => ({ filePreviewPanelOpen: !s.filePreviewPanelOpen })),

  previewFile: (sessionId, url, kind) => {
    const id = makeTabId(sessionId, url);
    const cur = get().filePreviewTabs;
    const existing = cur.find((t) => t.id === id);
    if (existing) {
      // 复用：清掉旧 content / error，state 回到 loading，panel 打开，激活
      set({
        filePreviewPanelOpen: true,
        activeFileTabId: id,
        filePreviewTabs: cur.map((t) =>
          t.id === id
            ? {
                ...t,
                state: "loading",
                content: undefined,
                error: undefined,
              }
            : t
        ),
      });
      return id;
    }
    const tab: FilePreviewTab = {
      id,
      sessionId,
      url,
      title: deriveTabTitle(url),
      kind,
      state: "loading",
      createdAt: Date.now(),
    };
    set({
      filePreviewPanelOpen: true,
      activeFileTabId: id,
      filePreviewTabs: [...cur, tab],
    });
    return id;
  },

  selectFileTab: (tabId) => {
    if (!get().filePreviewTabs.some((t) => t.id === tabId)) return;
    set({ activeFileTabId: tabId });
  },

  closeFileTab: (tabId) => {
    const cur = get().filePreviewTabs;
    const idx = cur.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const next = cur.filter((t) => t.id !== tabId);
    let nextActive = get().activeFileTabId;
    if (nextActive === tabId) {
      // 优先选同 session 的相邻 tab；没有就 null
      const removedSession = cur[idx].sessionId;
      const sameSession = next.filter((t) => t.sessionId === removedSession);
      nextActive = sameSession.length > 0 ? sameSession[sameSession.length - 1].id : null;
    }
    set({ filePreviewTabs: next, activeFileTabId: nextActive });
  },

  setTabLoaded: (tabId, content, mime) =>
    set((s) => ({
      filePreviewTabs: s.filePreviewTabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              state: "loaded",
              content,
              mime: mime ?? t.mime,
              error: undefined,
            }
          : t
      ),
    })),

  setTabError: (tabId, error) =>
    set((s) => ({
      filePreviewTabs: s.filePreviewTabs.map((t) =>
        t.id === tabId
          ? { ...t, state: "error", error, content: undefined }
          : t
      ),
    })),
}));

/**
 * 派生 selector：返回当前 session 的 tab 列表（已 memo 在 caller 处）。
 * Panel UI 用这个渲染 tab bar / body；其他 session 的 tab 留在 store 里
 * 不渲染，但切回该 session 时还在。
 *
 * 注意：早期版本在这里直接 `s.filePreviewTabs.filter(...)`，会让
 * useSyncExternalStore 误判为新 snapshot、无限 re-render。
 * 现在 caller 必须自己选 raw tabs + useMemo 派生，这里只暴露纯函数。
 */
export function tabsForSession(
  tabs: FilePreviewTab[],
  sessionId: string | null | undefined
): FilePreviewTab[] {
  if (!sessionId) return [];
  return tabs.filter((t) => t.sessionId === sessionId);
}

/** 派生 selector：当前 active 的 tab。 */
export function useActiveFileTab() {
  return useUIStore((s) => {
    if (!s.activeFileTabId) return null;
    return s.filePreviewTabs.find((t) => t.id === s.activeFileTabId) ?? null;
  });
}

/** 在树里按 id 查找 message（任意深度）。用于 sub-agent 面板的路由解析。 */
export function findInTree(
  messages: ChatMessage[],
  id: string
): ChatMessage | null {
  for (const m of messages) {
    if (m.id === id) return m;
    if (m.subMessages && m.subMessages.length > 0) {
      const r = findInTree(m.subMessages, id);
      if (r) return r;
    }
  }
  return null;
}

// 把 type-only import 放在最后避免循环
import type { ChatMessage } from "@/lib/message-types";