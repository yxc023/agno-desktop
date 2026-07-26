/**
 * Settings store: 应用级设置
 *
 * user_id 现在跟实例绑定（见 instances-store 的 AgnoInstance.userId），
 * 不再存这里。设置页里残留的 user_id / userIdConfirmed 字段读时会拿到 undefined，
 * UI 端走 instance.userId。
 */

import { create } from "zustand";
import { loadJSON, saveJSON } from "@/lib/storage";

export type Theme = "dark" | "light" | "system";

/**
 * 把 Theme（包含 "system"）解析成实际生效的 "dark" / "light"。
 * "system" 时跟随 prefers-color-scheme media query。
 */
export function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme === "system") {
    if (typeof window === "undefined") return "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme;
}

export interface Settings {
  theme: Theme;
  defaultModel?: string;
  autoScroll: boolean;
  showToolDetails: boolean;
  collapseReasoning: boolean;
  typewriterEffect: boolean;
  currentView: "chat" | "instances" | "settings";
  sidebarCollapsed: boolean;
  /** ChatPage 分栏宽度（持久化）——左 sessions 栏、右 InstancesPanel 栏 */
  chatSessionsWidth?: number;
  chatRightWidth?: number;
  /** 主侧栏（AppShell 左侧导航）展开时的宽度（持久化） */
  sidebarWidth?: number;
  /** 启动时自动检查更新（仅 Tauri desktop 生效；browser / dev 默认 no-op） */
  autoCheckUpdate: boolean;
}

const KEY = "agno:settings";

const defaults: Settings = {
  theme: "light",
  autoScroll: true,
  showToolDetails: false,
  collapseReasoning: false,
  typewriterEffect: true,
  currentView: "chat",
  sidebarCollapsed: false,
  autoCheckUpdate: true,
};

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
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
}));