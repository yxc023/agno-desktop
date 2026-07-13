/**
 * useUpdater —— 自动更新 hook
 *
 * 设计目标：
 * 1. 启动时（自动）检查一次 —— 通过 settings.autoCheckUpdate 控制
 * 2. 提供手动 checkNow() / install() / dismiss() 给 UI 调用
 * 3. 状态机收敛在一个 hook 里：
 *     idle -> checking -> (up-to-date | available -> downloading -> ready -> dismissed)
 *                          \-> error
 * 4. 不在浏览器 dev 环境触发任何 plugin 调用（避免 console 噪音）
 *
 * 设计取舍：
 * - 用 zustand 的 selector 模式：每次只订阅需要的字段，避免不相关的
 *   settings 变化触发整个 hook 重渲染。
 * - 检查节流：mount 时只检查一次 + 距离上次检查 >24h 才会自动 re-check，
 *   防止用户在多个窗口/重启应用时短时间内反复请求 endpoint。
 * - error 不弹 toast：交给调用方（toast UI 组件）根据 state.error 渲染，
 *   这样 dismiss 后下一次 checkNow() 可以清空旧错误。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  checkForUpdate,
  downloadAndInstall,
  isUpdaterAvailable,
  type InstallResult,
  type ProgressCallback,
  type UpdateInfo,
} from "@/lib/updater";
import { useSettingsStore } from "@/stores/settings-store";

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
}

const initial: UpdaterState = {
  status: "idle",
  info: null,
  downloaded: 0,
  total: null,
  error: null,
  lastChecked: null,
  available: false,
};

/**
 * 检查结果在 sessionStorage 中的持久化 key。
 *
 * 持久化 lastChecked：浏览器/webview 刷新后仍能保留节流窗口。
 * webview 关掉再开会丢失，因此"启动时检查"逻辑在每次冷启动仍会
 * 触发；这里只防止 HMR / 软刷新时的短时间反复请求。
 */
const STORAGE_KEY = "agno:updater:last-checked";

export function useUpdater(): UpdaterState & UpdaterActions {
  const [state, setState] = useState<UpdaterState>(() => ({
    ...initial,
    available: isUpdaterAvailable(),
  }));

  // 防止 dev 模式下 React StrictMode 双调用触发两次 check
  const checkingRef = useRef(false);
  const autoCheckedRef = useRef(false);

  // 支持两种形式：
  //   setStateSafe({ foo: 1 })           — 浅合并
  //   setStateSafe(s => ({ foo: s.x+1 })) — 基于当前 state 派生（避免读到陈旧值）
  const setStateSafe = useCallback(
    (patch: Partial<UpdaterState> | ((s: UpdaterState) => Partial<UpdaterState>)) => {
      setState((s) =>
        typeof patch === "function" ? { ...s, ...patch(s) } : { ...s, ...patch }
      );
    },
    []
  );

  /** 手动触发检查 */
  const checkNow = useCallback(async () => {
    if (checkingRef.current) return;
    if (!isUpdaterAvailable()) {
      setStateSafe({
        status: "error",
        error: "当前环境不支持自动更新（浏览器 / 移动端 / dev 模式）",
      });
      return;
    }
    checkingRef.current = true;
    setStateSafe({ status: "checking", error: null });
    try {
      const info = await checkForUpdate();
      const now = Date.now();
      persistLastChecked(now);
      if (info) {
        setStateSafe({
          status: "available",
          info,
          lastChecked: now,
          downloaded: 0,
          total: null,
        });
      } else {
        setStateSafe({ status: "up-to-date", info: null, lastChecked: now });
        toast.success("已是最新版本", { duration: 2500 });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      setStateSafe({
        status: "error",
        error: message || "检查更新失败",
      });
    } finally {
      checkingRef.current = false;
    }
  }, [setStateSafe]);

  /** 下载并安装 */
  const install = useCallback(async () => {
    if (!isUpdaterAvailable()) return;
    setStateSafe({
      status: "downloading",
      downloaded: 0,
      total: null,
      error: null,
    });

    const onProgress: ProgressCallback = (evt) => {
      if (evt.kind === "started") {
        setStateSafe({
          total: typeof evt.contentLength === "number" ? evt.contentLength : null,
        });
      } else if (evt.kind === "progress") {
        setStateSafe((s) => ({
          downloaded: s.downloaded + evt.chunkLength,
        }));
      }
    };

    const result: InstallResult = await downloadAndInstall(onProgress);
    if (result.ok) {
      setStateSafe({ status: "ready" });
      // 不自动重启——交给 UpdateToast 的 ready dialog 让用户确认。
      // 之前的 setTimeout(relaunchApp, 1500) 太隐形，用户经常错过；
      // 现在用显式 dialog + [立即重启]/[稍后] 按钮。
    } else {
      // 用户取消 (no-update) 不算错；其它都展示 error
      if (result.reason !== "no-update") {
        setStateSafe({ status: "error", error: result.message });
      } else {
        setStateSafe({ status: "up-to-date" });
      }
    }
  }, [setStateSafe]);

  /** 用户 dismiss 当前更新提示 */
  const dismiss = useCallback(() => {
    setStateSafe({ status: "idle", error: null });
  }, [setStateSafe]);

  const clearError = useCallback(() => {
    setStateSafe({ error: null, status: "idle" });
  }, [setStateSafe]);

  // 启动时自动检查（一次性，由 settings.autoCheckUpdate 控制）
  useEffect(() => {
    if (autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    if (!isUpdaterAvailable()) return;
    const settings = useSettingsStore.getState();
    if (!settings.autoCheckUpdate) return;
    const last = readLastChecked();
    const now = Date.now();
    if (last && now - last < AUTO_CHECK_THROTTLE_MS) return;
    // 延后到 idle 之后再触发，避免与其它启动 IO 抢资源
    const t = setTimeout(() => {
      void checkNow();
    }, 5000);
    return () => clearTimeout(t);
  }, [checkNow]);

  return {
    ...state,
    checkNow,
    install,
    dismiss,
    clearError,
  };
}

/* ---------------------------------------------------------------- *
 * 内部：last-checked 持久化
 * ---------------------------------------------------------------- */

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