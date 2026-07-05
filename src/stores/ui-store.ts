/**
 * UI store: 临时 UI 状态（对话框、面板展开等）
 */

import { create } from "zustand";

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
}

export const useUIStore = create<UIState>((set) => ({
  showAddInstance: false,
  setShowAddInstance: (v) => set({ showAddInstance: v }),

  commandOpen: false,
  setCommandOpen: (v) => set({ commandOpen: v }),

  pendingApproval: null,
  setPendingApproval: (v) => set({ pendingApproval: v }),

  instanceSettingsOpen: false,
  setInstanceSettingsOpen: (v) => set({ instanceSettingsOpen: v }),
}));