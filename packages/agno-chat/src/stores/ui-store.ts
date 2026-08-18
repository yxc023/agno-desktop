/**
 * UI store: 包级别的 UI 状态管理
 *
 * 管理文件预览、sub-agent 面板、approval dialog 等 UI 状态。
 * 这些状态在应用中属于 app 层，但包内的组件需要它们来正常工作。
 * 应用层可以通过 setContext 注入回调来覆盖默认行为。
 */

import { create } from "zustand";

/** 正在等待审批的 agent 工具调用 */
export interface PendingApproval {
  runId: string;
  agentId: string;
  sessionId: string;
  toolCalls: Array<{
    tool_call_id: string;
    tool_name: string;
    tool_args: Record<string, unknown>;
  }>;
}

/** 文件预览 tab */
export interface FilePreviewTab {
  id: string;
  sessionId: string;
  url: string;
  title: string;
  kind: "md" | "text" | "code" | "image" | "html";
  state: "loading" | "loaded" | "error";
  content?: string;
  mime?: string;
  error?: string;
}

/** Sub-agent 面板导航栈条目 */
export interface SubAgentPanelEntry {
  sessionId: string;
  subMessageId: string;
}

interface UIState {
  pendingApproval: PendingApproval | null;
  setPendingApproval: (p: PendingApproval | null) => void;

  filePreviewTabs: FilePreviewTab[];
  activeFileTabId: string | null;
  filePreviewPanelOpen: boolean;

  previewFile: (sessionId: string, url: string, kind: FilePreviewTab["kind"]) => void;
  closeFileTab: (tabId: string) => void;
  selectFileTab: (tabId: string) => void;
  closeFilePreviewPanel: () => void;
  setTabLoaded: (tabId: string, content: string, mime?: string) => void;
  setTabError: (tabId: string, error: string) => void;

  subAgentPanel: {
    stack: SubAgentPanelEntry[];
  };
  openSubAgentPanel: (sessionId: string, subMessageId: string) => void;
  pushSubAgentPanel: (sessionId: string, subMessageId: string) => void;
  popSubAgentPanel: () => void;
  closeSubAgentPanel: () => void;
}

let _tabCounter = 0;

export const useUIStore = create<UIState>((set, get) => ({
  pendingApproval: null,
  setPendingApproval: (p) => set({ pendingApproval: p }),

  filePreviewTabs: [],
  activeFileTabId: null,
  filePreviewPanelOpen: false,

  previewFile: (sessionId, url, kind) => {
    const id = `tab-${++_tabCounter}`;
    const title = url.split("/").pop() ?? url;
    const tab: FilePreviewTab = { id, sessionId, url, title, kind, state: "loading" };
    set((s) => ({
      filePreviewTabs: [...s.filePreviewTabs, tab],
      activeFileTabId: id,
      filePreviewPanelOpen: true,
    }));
  },

  closeFileTab: (tabId) =>
    set((s) => {
      const remaining = s.filePreviewTabs.filter((t) => t.id !== tabId);
      const activeAfter = s.activeFileTabId === tabId
        ? remaining.length > 0
          ? remaining[remaining.length - 1].id
          : null
        : s.activeFileTabId;
      return {
        filePreviewTabs: remaining,
        activeFileTabId: activeAfter,
        filePreviewPanelOpen: remaining.length > 0,
      };
    }),

  selectFileTab: (tabId) => set({ activeFileTabId: tabId }),

  closeFilePreviewPanel: () =>
    set((s) => ({
      filePreviewPanelOpen: false,
      filePreviewTabs: s.filePreviewTabs,
    })),

  setTabLoaded: (tabId, content, mime) =>
    set((s) => ({
      filePreviewTabs: s.filePreviewTabs.map((t) =>
        t.id === tabId ? { ...t, state: "loaded" as const, content, mime } : t
      ),
    })),

  setTabError: (tabId, error) =>
    set((s) => ({
      filePreviewTabs: s.filePreviewTabs.map((t) =>
        t.id === tabId ? { ...t, state: "error" as const, error } : t
      ),
    })),

  subAgentPanel: { stack: [] },
  openSubAgentPanel: (sessionId, subMessageId) =>
    set({ subAgentPanel: { stack: [{ sessionId, subMessageId }] } }),
  pushSubAgentPanel: (sessionId, subMessageId) =>
    set((s) => ({
      subAgentPanel: {
        stack: [...s.subAgentPanel.stack, { sessionId, subMessageId }],
      },
    })),
  popSubAgentPanel: () =>
    set((s) => ({
      subAgentPanel: {
        stack: s.subAgentPanel.stack.slice(0, -1),
      },
    })),
  closeSubAgentPanel: () => set({ subAgentPanel: { stack: [] } }),
}));

/** Hook: 当前活跃的 file preview tab */
export function useActiveFileTab() {
  return useUIStore((s) => {
    const id = s.activeFileTabId;
    if (!id) return null;
    return s.filePreviewTabs.find((t) => t.id === id) ?? null;
  });
}
