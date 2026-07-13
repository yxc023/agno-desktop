/**
 * UpdateToast —— 全局自动更新 toast 监听器
 *
 * 设计说明（基于 v0.0.4 的 macOS Overlay titlebar 重构）：
 * - downloading/ready 状态 → AppTitleBar 显示（标题栏右侧，全应用可见）
 * - available/error 状态 → toast 提示（右下角，瞬时）
 *
 * 状态 → UI 映射：
 *   idle / checking / up-to-date / downloading / ready  → 静默（交给 AppTitleBar）
 *   available                                          → 持续 toast（"立即更新 / 稍后"）
 *   error                                              → toast（错误信息 + "重试"按钮）
 *
 * dev / 浏览器环境：useUpdater 返回 available=false，
 * 整个组件所有 useEffect 都不触发，无 UI、无 console 噪音。
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { useUpdater } from "@/hooks/use-updater";

export function UpdateToast() {
  const updater = useUpdater();
  const { status, info, error, available } = updater;

  // 用 ref 持有 updater.actions 引用，避免 effect 在闭包里读到旧 status
  const actionsRef = useRef(updater);
  actionsRef.current = updater;

  /* ---------------- available: 持续 toast ---------------- */
  useEffect(() => {
    if (
      status === "available" &&
      info &&
      available &&
      lastAvailableToastVersionRef.current !== info.version
    ) {
      lastAvailableToastVersionRef.current = info.version;
      lastErrorRef.current = null;

      toast(
        <div className="flex flex-col gap-1.5">
          <div className="text-sm font-medium flex items-center gap-1.5">
            <Download className="h-3.5 w-3.5 text-accent" />
            发现新版本 v{info.version}
          </div>
          {info.notes && (
            <div className="text-xs text-muted-foreground line-clamp-3 max-w-[320px]">
              {info.notes}
            </div>
          )}
        </div>,
        {
          duration: Infinity,
          id: "updater-available",
          action: {
            label: "立即更新",
            onClick: () => void actionsRef.current.install(),
          },
          cancel: {
            label: "稍后",
            onClick: () => actionsRef.current.dismiss(),
          },
          onDismiss: () => {
            if (actionsRef.current.status === "available") {
              actionsRef.current.dismiss();
            }
          },
        }
      );
    }

    // 状态离开 available 时清掉 toast
    if (status !== "available") {
      toast.dismiss("updater-available");
      if (status !== "ready") {
        lastAvailableToastVersionRef.current = null;
      }
    }
  }, [status, info, available]);

  /* ---------------- error: 错误 toast ---------------- */
  useEffect(() => {
    if (status === "error" && error && lastErrorRef.current !== error) {
      lastErrorRef.current = error;
      lastAvailableToastVersionRef.current = null;
      toast.error(
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium">更新失败</div>
          <div className="text-xs text-muted-foreground line-clamp-3 max-w-[320px]">
            {error}
          </div>
        </div>,
        {
          duration: 6000,
          id: "updater-error",
          action: {
            label: "重试",
            onClick: () => void actionsRef.current.checkNow(),
          },
        }
      );
    }
    if (status !== "error") {
      toast.dismiss("updater-error");
      lastErrorRef.current = null;
    }
  }, [status, error]);

  // 此组件只负责 toast，无视觉元素。
  return null;
}

/* ---------------------------------------------------------------- */

const lastAvailableToastVersionRef = { current: null as string | null };
const lastErrorRef = { current: null as string | null };