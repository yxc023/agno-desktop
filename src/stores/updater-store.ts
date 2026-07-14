/**
 * Updater store —— 全局自动更新状态机
 *
 * 为什么是 zustand store 而不是 hook + useState：
 *
 * 原本的实现把状态放在 `useUpdater()` hook 的 `useState` 里。这会导致
 * 一个架构级 bug：**每个调用 `useUpdater()` 的组件各持一份独立 state**。
 *   - AppTitleBar 用 `useUpdater()` 看下载进度
 *   - SettingsPage 用 `useUpdater()` 触发「立即更新」
 *   - UpdateToast 用 `useUpdater()` 弹右下角通知
 *
 * 当用户在 SettingsPage 点「立即更新」时，install() 只更新 SettingsPage 那份
 * state；AppTitleBar 的 state 仍是 idle，标题栏完全没动静——用户以为按钮
 * 没响应。同时 auto-check 在每个组件 mount 时都会跑一次，启动期要发 3 个
 * HTTP 请求。
 *
 * 修复方式：把 state 和 actions 全部挪到 zustand store。三处 useUpdater()
 * 调用读同一份 state，actions 也是同一份引用。auto-check 用模块级 flag
 * 保证只跑一次。
 *
 * 状态机（保持不变）：
 *   idle -> checking -> (up-to-date | available -> downloading -> ready -> dismissed)
 *                        \-> error
 */

import { create } from "zustand";
import { toast } from "sonner";
import {
  checkForUpdate,
  downloadAndInstall,
  isUpdaterAvailable,
  type InstallResult,
  type ProgressCallback,
  type UpdateInfo,
} from "@/lib/updater";

/** 节流：自动检查至少间隔 24 小时 */
const AUTO_CHECK_THROTTLE_MS = 24 * 60 * 60 * 1000;

export type UpdaterStatus =
  | "idle" // 初始 / 用户 dismiss 后
  | "checking" // checkForUpdate 进行中
  | "up-to-date" // 检查完成，无更新
  | "available" // 检查完成，有更新（等待用户决定是否下载）
  | "downloading" // 下载中
  | "ready" // 下载完成，等待重启
  | "error"; // 出错

export interface UpdaterState {
  status: UpdaterStatus;
  /** 当前发现的更新元数据 */
  info: UpdateInfo | null;
  /** 已下载字节数 */
  downloaded: number;
  /** 总字节数（如果 server 返回 content-length） */
  total: number | null;
  /** 错误消息（用户可读） */
  error: string | null;
  /** 上次检查时间（epoch ms），用于节流判断 */
  lastChecked: number | null;
  /** updater 是否在当前环境可用（dev / browser / mobile 都不可用） */
  available: boolean;
}

export interface UpdaterActions {
  /** 手动触发一次检查（无视节流） */
  checkNow: () => Promise<void>;
  /** 下载并安装当前发现的更新（调用前需 status === 'available'） */
  install: () => Promise<void>;
  /** 用户手动 dismiss 当前发现的更新（重置到 idle） */
  dismiss: () => void;
  /** 清空错误状态 */
  clearError: () => void;
  /**
   * 直接把状态切到 error（不重置其它字段）。
   *
   * 用途：appTitleBar 的「重启」按钮调 relaunchApp() 失败时，
   * 我们已经把 status dismiss 成 idle 了，但又想让 error chip 显示
   * 给用户看，所以走这条路径而不是 install() 内部的 set({status: 'error'})。
   */
  setError: (message: string) => void;
}

const initialState: UpdaterState = {
  status: "idle",
  info: null,
  downloaded: 0,
  total: null,
  error: null,
  lastChecked: null,
  available: isUpdaterAvailable(),
};

/**
 * 检查结果在 sessionStorage 中的持久化 key。
 *
 * 持久化 lastChecked：webview 软刷新后仍能保留节流窗口。
 * webview 关掉再开会丢失，因此"启动时检查"逻辑在每次冷启动仍会触发；
 * 这里只防止 HMR / 软刷新时的短时间反复请求。
 */
const STORAGE_KEY = "agno:updater:last-checked";

function readLastChecked(): number | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const ts = parseInt(raw, 10);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

function persistLastChecked(ts: number): void {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(STORAGE_KEY, String(ts));
    }
  } catch {
    // sessionStorage 不可用（隐私模式）——不影响主流程
  }
}

/**
 * 全局"自动检查已发起"flag：模块级而非 ref，
 * 因为 zustand store 跨组件共享，ref 会被每个 hook 实例重置成 false，
 * 退化回"每个组件各跑一次"的老 bug。
 */
let autoCheckScheduled = false;
/** 当前是否正在 check/download——并发保护 */
let checkingInFlight = false;

export const useUpdaterStore = create<UpdaterState & UpdaterActions>(
  (set) => ({
    ...initialState,

    /** 手动触发检查 */
    checkNow: async () => {
      if (checkingInFlight) return;
      if (!isUpdaterAvailable()) {
        set({
          status: "error",
          error: "当前环境不支持自动更新（浏览器 / 移动端 / dev 模式）",
        });
        return;
      }
      checkingInFlight = true;
      set({ status: "checking", error: null });
      try {
        const info = await checkForUpdate();
        const now = Date.now();
        persistLastChecked(now);
        if (info) {
          set({
            status: "available",
            info,
            lastChecked: now,
            downloaded: 0,
            total: null,
          });
        } else {
          set({ status: "up-to-date", info: null, lastChecked: now });
          toast.success("已是最新版本", { duration: 2500 });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({
          status: "error",
          error: message || "检查更新失败",
        });
      } finally {
        checkingInFlight = false;
      }
    },

    /** 下载并安装 */
    install: async () => {
      if (!isUpdaterAvailable()) return;
      // 重置进度（info 保留，因为是从 available 转过来的）
      set({
        status: "downloading",
        downloaded: 0,
        total: null,
        error: null,
      });

      const onProgress: ProgressCallback = (evt) => {
        if (evt.kind === "started") {
          set({
            total:
              typeof evt.contentLength === "number" ? evt.contentLength : null,
          });
        } else if (evt.kind === "progress") {
          set((s) => ({ downloaded: s.downloaded + evt.chunkLength }));
        }
      };

      const result: InstallResult = await downloadAndInstall(onProgress);
      if (result.ok) {
        set({ status: "ready" });
        // 不自动重启——交给 AppTitleBar 的「重启」按钮让用户确认。
      } else {
        // 用户取消 (no-update) 不算错；其它都展示 error
        if (result.reason !== "no-update") {
          set({ status: "error", error: result.message });
        } else {
          set({ status: "up-to-date" });
        }
      }
    },

    /** 用户 dismiss 当前更新提示 */
    dismiss: () => {
      set({ status: "idle", error: null });
    },

    /** 清空错误状态 */
    clearError: () => {
      set({ error: null, status: "idle" });
    },

    /** 直接把状态切到 error（不重置其它字段） */
    setError: (message: string) => {
      set({ status: "error", error: message });
    },
  })
);

/* ---------------------------------------------------------------- *
 * 启动时自动检查（一次性）
 *
 * 为什么不在 store 创建时直接调用：
 * - store 模块求值发生在 import 阶段（早于任何 React 组件 mount）。
 *   此时拿不到 settings（zustand store 也未完成初始化，存在 init-order 风险）。
 * - 延后到组件 mount 时读取 settings 更稳。
 *
 * 为什么用模块级 flag 而不是每个 useUpdater 调用方各自 ref：
 * - 老实现 `autoCheckedRef = useRef(false)` 每个 hook 实例独立，
 *   会导致 3 个组件 mount 时触发 3 次 auto-check。
 * - 模块级 flag 保证整个应用只发一次启动检查。
 *
 * 注意：这里暴露一个函数而不是在 hook 里 useEffect，是因为：
 * - 调用方是 `useUpdater()` hook（每个组件都跑）。
 * - 用模块级 flag 防止 N 次 useEffect 真的发起 N 次 check。
 * ---------------------------------------------------------------- */

export function scheduleAutoCheck(): void {
  if (autoCheckScheduled) return;
  autoCheckScheduled = true;
  if (!isUpdaterAvailable()) return;

  // 延后 5s，避开启动期其它 IO
  setTimeout(() => {
    // 二次检查：上一个 setTimeout 已经发起就不再发
    const last = readLastChecked();
    const now = Date.now();
    if (last && now - last < AUTO_CHECK_THROTTLE_MS) return;
    void useUpdaterStore.getState().checkNow();
  }, 5000);
}