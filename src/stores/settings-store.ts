/**
 * 从 agno-chat 包重新导出 settings-store。
 * 应用层和包内共享同一个 zustand store 实例。
 */
export {
  useSettingsStore,
  resolveTheme,
  type Settings,
  type Theme,
} from "../../packages/agno-chat/src/index.ts";