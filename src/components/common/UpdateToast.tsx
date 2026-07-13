/**
 * UpdateToast —— 全局自动更新 UI 监听器
 *
 * 这个组件本身不渲染任何视觉元素（不返回 <div>），而是 hook 化的
 * 副作用容器：挂在 App 根节点下，订阅 useUpdater() 的状态，把状态
 * 映射到对应的 UI（toast / dialog）。
 *
 * 为什么用"无渲染"组件而不是 hook 调用点：
 * - 把所有 updater 相关 UI（toast、进度 dialog、错误提示）集中在一个
 *   文件里，新增 UX 决策（例如"下载时震动"、"完成后播放提示音"）
 *   不会污染业务组件。
 * - 在 App.tsx 里只需要 <UpdateToast /> 一行就能启用全部 updater UI，
 *   关闭时直接删掉这一行即可。
 *
 * 状态 → UI 映射：
 *   idle / checking / up-to-date            → 静默
 *   available                              → 持续 toast（"立即更新 / 稍后"）
 *   downloading                            → 对话框（带进度条 + 百分比）
 *   ready                                  → 确认 dialog（"立即重启 / 稍后"）
 *   error                                  → toast（错误信息 + "重试"按钮）
 *
 * dev / 浏览器环境：useUpdater 返回 available=false，
 * 整个组件所有 useEffect 都不触发，无 UI、无 console 噪音。
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Download, RefreshCw, X } from "lucide-react";
import { useUpdater } from "@/hooks/use-updater";
import { relaunchApp } from "@/lib/updater";
import { cn } from "@/lib/utils";

export function UpdateToast() {
  const updater = useUpdater();
  const { status, info, downloaded, total, error, available } = updater;

  // 防止同一状态重复 toast / dismiss 上一帧 toast
  const lastAvailableToastVersionRef = useRef<string | null>(null);
  const lastErrorRef = useRef<string | null>(null);

  // 用 ref 持有 updater.actions 引用，避免 effect 在闭包里读到旧 status
  // （TS 也会因为 deps 里已有 status 而拒绝在 effect 内重新读 updater.status）
  const actionsRef = useRef(updater);
  actionsRef.current = updater;

  /* ---------------- available: 持续 toast ---------------- */
  useEffect(() => {
    // 只在"刚发现"更新时弹 toast，避免 user 已经在 dialog 操作时反复 toast
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
            // 用户关掉 toast 也算 dismiss；通过 actionsRef 读最新 status
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

  /* ---------------- downloading: 进度 dialog ---------------- */
  const showDownloadDialog = status === "downloading";
  const percent =
    total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;

  /* ---------------- ready: 确认重启 dialog ---------------- */
  // 重要：这里需要 ref 而不是直接用 updater.dismiss，因为 onClick 在 dialog 渲染时
  // capture，updater.dismiss 引用变化不会重新绑定。
  const dismissRef = useRef(updater.dismiss);
  dismissRef.current = updater.dismiss;

  return (
    <>
      {/* downloading dialog（进度）*/}
      <Dialog open={showDownloadDialog} onOpenChange={() => { /* 不可关闭 */ }}>
      <DialogContent
        className="max-w-sm"
        showClose={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="h-4 w-4 text-accent animate-spin" />
            正在下载更新
            {info?.version && (
              <span className="text-muted-foreground font-normal">
                v{info.version}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            请稍候，下载完成后会自动安装并重启应用
          </DialogDescription>
        </DialogHeader>

        {/* 进度条 */}
        <div className="space-y-1.5">
          <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full bg-accent transition-all duration-300",
                percent === null && "animate-pulse w-1/3"
              )}
              style={
                percent !== null
                  ? { width: `${percent}%` }
                  : undefined
              }
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground font-mono tabular-nums">
            <span>
              {total
                ? `${formatBytes(downloaded)} / ${formatBytes(total)}`
                : formatBytes(downloaded)}
            </span>
            <span>{percent !== null ? `${percent}%` : "…"}</span>
          </div>
        </div>

        <DialogFooter className="sm:justify-start">
          <Button
            variant="ghost"
            size="sm"
            disabled
            className="text-muted-foreground"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            请勿关闭应用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

      {/* ready dialog（确认重启）—— 用户必须主动点"立即重启"才会重启 */}
      <Dialog
        open={status === "ready"}
        onOpenChange={(open) => {
          // 点关闭 / Esc / 点击遮罩 = dismiss（用户选"稍后"）
          if (!open) dismissRef.current();
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-success" />
              更新已下载完成
              {info?.version && (
                <span className="text-muted-foreground font-normal">
                  v{info.version}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              是否立即重启应用以完成更新？选择「稍后」会在你下次主动重启时生效。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="ghost"
              onClick={dismissRef.current}
            >
              稍后
            </Button>
            <Button
              onClick={() => {
                // 先 dismiss dialog（关掉弹窗，避免 race）
                dismissRef.current();
                // 然后触发 relaunch
                void relaunchApp();
              }}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              立即重启
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ---------------------------------------------------------------- */

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}