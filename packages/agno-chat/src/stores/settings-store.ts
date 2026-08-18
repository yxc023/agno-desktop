/**
 * Settings store: 用户偏好设置
 *
 * 包级别的设置 store，管理渲染相关的用户偏好。
 * 应用层可通过 setContext 注入初始值。
 */

import { create } from "zustand";

interface SettingsState {
  hideReasoning: boolean;
  briefToolCalls: boolean;
  collapseReasoning: boolean;

  setHideReasoning: (v: boolean) => void;
  setBriefToolCalls: (v: boolean) => void;
  setCollapseReasoning: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  hideReasoning: false,
  briefToolCalls: false,
  collapseReasoning: false,

  setHideReasoning: (v) => set({ hideReasoning: v }),
  setBriefToolCalls: (v) => set({ briefToolCalls: v }),
  setCollapseReasoning: (v) => set({ collapseReasoning: v }),
}));
