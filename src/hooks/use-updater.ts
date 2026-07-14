/**
 * useUpdater —— 自动更新 hook（薄包装）
 *
 * 历史：
 * - 早期实现把 state 放在 `useState` 里，导致每个组件各持一份独立 state。
 * - AppTitleBar / SettingsPage / UpdateToast 互相看不见对方的状态变化——
 *   这是 v0.0.4 标题栏不更新的根因。
 * - 现在 state 全部在 `useUpdaterStore` (zustand) 里，hook 只负责订阅 + 触发
 *   启动期自动检查。
 *
 * 返回值：跟旧版完全一致（state + actions），所以 AppTitleBar / SettingsPage
 * / UpdateToast 的调用代码不需要改。
 *
 * 调用方可以这样用：
 *   const updater = useUpdater();
 *   updater.install();
 *   const { status, downloaded, total } = updater;
 *
 * 也可以直接用底层 store（推荐给非组件代码）：
 *   useUpdaterStore.getState().install();
 */

import { useEffect } from "react";
import {
  useUpdaterStore,
  scheduleAutoCheck,
  type UpdaterState,
  type UpdaterActions,
} from "@/stores/updater-store";

export type { UpdaterState, UpdaterActions, UpdaterStatus } from "@/stores/updater-store";

/**
 * 订阅 updater 全量 state + actions。
 *
 * 实现：用 shallow selector 把整个对象挑出来——zustand v5 默认用 Object.is，
 * 这里我们展开成一组扁平 selector，对每个字段单独订阅，避免「任一字段变
 * 都重渲染」。但 actions 是稳定引用（store 创建时一次定型），所以它们不会
 * 触发额外渲染。
 */
export function useUpdater(): UpdaterState & UpdaterActions {
  const status = useUpdaterStore((s) => s.status);
  const info = useUpdaterStore((s) => s.info);
  const downloaded = useUpdaterStore((s) => s.downloaded);
  const total = useUpdaterStore((s) => s.total);
  const error = useUpdaterStore((s) => s.error);
  const lastChecked = useUpdaterStore((s) => s.lastChecked);
  const available = useUpdaterStore((s) => s.available);
  // actions 是 store 创建时定型的稳定引用，单独取出来减少 selector 调用
  const checkNow = useUpdaterStore((s) => s.checkNow);
  const install = useUpdaterStore((s) => s.install);
  const dismiss = useUpdaterStore((s) => s.dismiss);
  const clearError = useUpdaterStore((s) => s.clearError);
  const setError = useUpdaterStore((s) => s.setError);

  // 启动期自动检查：每个组件 mount 都会跑，但 scheduleAutoCheck 内部用
  // 模块级 flag 保证整个应用只发一次。
  useEffect(() => {
    scheduleAutoCheck();
  }, []);

  return {
    status,
    info,
    downloaded,
    total,
    error,
    lastChecked,
    available,
    checkNow,
    install,
    dismiss,
    clearError,
    setError,
  };
}