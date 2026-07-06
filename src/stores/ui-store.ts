/**
 * UI store: 临时 UI 状态（对话框、面板展开等）
 */

import { create } from "zustand";

/** 上限：sub-agent 面板栈的最大深度（含根）。超过后 push 直接 no-op。 */
const MAX_PANEL_STACK_DEPTH = 8;

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
}));

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