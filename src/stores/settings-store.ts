/**
 * Settings store: 应用级设置
 *
 * user_id 关键设计：
 * - 默认空字符串（不是随机）
 * - 首次启动会弹窗要求设置
 * - 在 chat 页必须设置才能发消息
 * - 用于 AGNO 的 memory / session 跨实例归类
 */

import { create } from "zustand";
import { loadJSON, saveJSON } from "@/lib/storage";

export type Theme = "dark" | "light";

export interface Settings {
  theme: Theme;
  /** 设备级 user_id（用户自己设定） */
  userId: string;
  /** 是否已首次确认过 user_id（用于关闭首次设置弹窗） */
  userIdConfirmed: boolean;
  defaultModel?: string;
  autoScroll: boolean;
  showToolDetails: boolean;
  collapseReasoning: boolean;
  typewriterEffect: boolean;
  currentView: "chat" | "instances" | "settings";
  sidebarCollapsed: boolean;
}

const KEY = "agno-v2:settings";

const defaults: Settings = {
  theme: "dark",
  userId: "", // 强制用户自己设置
  userIdConfirmed: false,
  autoScroll: true,
  showToolDetails: false,
  collapseReasoning: false,
  typewriterEffect: true,
  currentView: "chat",
  sidebarCollapsed: false,
};

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
  /** 检查 user_id 是否有效（用于守卫） */
  hasUserId: () => boolean;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...defaults,
  ...loadJSON<Partial<Settings>>(KEY, {}),

  update: (patch) => {
    set((s) => {
      const next = { ...s, ...patch };
      const persisted: Partial<Settings> = { ...next };
      saveJSON(KEY, persisted);
      return next;
    });
  },

  reset: () => {
    saveJSON(KEY, defaults);
    set({ ...defaults });
  },

  hasUserId: () => {
    return get().userId.trim().length > 0;
  },
}));