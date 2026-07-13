/**
 * AppTitleBar —— macOS 风格的自定义标题栏
 *
 * 设计背景：
 * - tauri.conf.json 的 titleBarStyle 设为 "Overlay"，让 React 内容延伸到
 *   标题栏位置（原本是 macOS 原生 titlebar，约 28pt 高）。
 * - macOS traffic light 按钮（左上红黄绿）仍然存在并浮动在最前面。
 * - React 内容从 (0, 0) 开始，左侧 pl-20（约 80pt）让出 traffic light 区域。
 *
 * 这个组件的内容：
 * - 左侧：让出 traffic light 的空白 + （可选）app 标题
 * - 右侧：自动更新状态/按钮——这是跟业务最相关的部分：
 *   - downloading → 转圈 + 进度文字 + 百分比
 *   - ready → 「重启」按钮
 *   - 其余状态 → 不渲染（保持标题栏简洁）
 *
 * data-tauri-drag-region 让整个 bar 可拖动窗口，但 inner 控件（按钮）保持
 * 原生 click 行为——这是 Tauri 2 的标准做法。
 */

import { Loader2, RefreshCw } from "lucide-react";
import { useUpdater } from "@/hooks/use-updater";
import { relaunchApp } from "@/lib/updater";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AppTitleBar() {
  const updater = useUpdater();
  const { status, info, downloaded, total } = updater;

  const showDownloadUI = status === "downloading" && info;
  const showReadyUI = status === "ready" && info;

  const percent =
    total && total > 0
      ? Math.min(100, Math.round((downloaded / total) * 100))
      : null;

  return (
    <div
      data-tauri-drag-region
      className={cn(
        "fixed top-0 left-0 right-0 h-7 z-50",
        "flex items-center justify-between",
        // 微微磨砂的底色，跟 macOS titlebar 视觉一致
        "bg-background/70 backdrop-blur-md border-b border-border/50"
      )}
    >
      {/* 左侧：让出 traffic light (~80pt) + app 标题占位 */}
      <div className="pl-20 flex items-center h-full">
        <span className="text-[11px] font-medium text-muted-foreground select-none pointer-events-none">
          Agno Desktop
        </span>
      </div>

      {/* 右侧：更新状态/按钮 */}
      <div className="pr-3 flex items-center gap-2 h-full">
        {showDownloadUI && (
          <div
            data-tauri-drag-region={false}
            className="flex items-center gap-2 text-[11px] text-muted-foreground"
          >
            <Loader2 className="h-3 w-3 animate-spin text-accent" />
            <span>
              正在下载 v{info.version}
              {percent !== null && (
                <span className="ml-1.5 font-mono tabular-nums text-foreground/70">
                  {percent}%
                </span>
              )}
            </span>
          </div>
        )}

        {showReadyUI && (
          <Button
            size="sm"
            variant="default"
            className="h-6 px-2.5 text-[11px]"
            onClick={() => {
              updater.dismiss();
              void relaunchApp();
            }}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            重启
          </Button>
        )}
      </div>
    </div>
  );
}