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
 *   - downloading → 转圈 + 内联进度条 + 进度文字 + 百分比
 *   - ready       → 「重启」按钮
 *   - 其余状态    → 不渲染（保持标题栏简洁）
 *
 * data-tauri-drag-region 让整个 bar 可拖动窗口，但 inner 控件（按钮/进度区）
 * 必须显式设置 data-tauri-drag-region={false}，否则 Tauri 会把 click 当作
 * drag-start，按钮完全点不动——这是 v2 的一个易踩坑点。
 */

import { AlertTriangle, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useUpdater } from "@/hooks/use-updater";
import { relaunchApp } from "@/lib/updater";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function AppTitleBar() {
  const updater = useUpdater();
  const { status, info, downloaded, total, error } = updater;

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
        {status === "downloading" && (
          <DownloadIndicator
            infoVersion={info?.version}
            downloaded={downloaded}
            total={total}
          />
        )}

        {status === "ready" && info && (
          <RestartButton
            version={info.version}
            onRestart={async () => {
              // 先 dismiss 把 title bar UI 清掉，避免 relaunch 期间按钮还在；
              // 如果 relaunch 失败，再 fallback 到 error 状态让用户看到反馈。
              updater.dismiss();
              try {
                await relaunchApp();
                // 成功路径：app 即将退出，新版进程接管。代码到这里基本不会被
                // 执行到（relaunch 内部 exit(0)），但保险起见写一行注释。
              } catch (err) {
                // relaunch 失败（plugin 未注册 / capability 没开 / 用户取消提权）
                // 把状态切到 error，让右上角 error chip 给用户反馈
                updater.setError(
                  err instanceof Error
                    ? err.message
                    : "重启失败，请手动关闭并重新打开应用"
                );
              }
            }}
          />
        )}

        {status === "error" && (
          <UpdateErrorChip error={error} onRetry={updater.checkNow} />
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * 错误提示
 *
 * 之前错误只在 toast / SettingsPage 显示，但标题栏右侧永远是空白——
 * 用户在 dashboard / chat 页看不到反馈，要切到 settings 才看到。
 *
 * 标题栏右侧显示一个 chip：
 *   ⚠ 更新失败  · 重试
 *
 * - cross-device 错误给出专门的 tooltip 说明（macOS 临时目录与应用安装
 *   目录跨设备的常见情况，详见 lib/updater.ts 的 classifyError）。
 * - 重试按钮立即调 checkNow()（不依赖 store 检查节流）。
 * ---------------------------------------------------------------- */

interface UpdateErrorChipProps {
  error: string | null;
  onRetry: () => void | Promise<void>;
}

// 单独 export 是为了让测试文件能直接拿这个组件做 SSR 测试。
/* oxlint-disable-next-line react/no-children-prop */
export function UpdateErrorChip({ error, onRetry }: UpdateErrorChipProps) {
  const isCrossDevice = /cross.?device|os error 18/i.test(error ?? "");

  // 文案针对最终用户，不要出现 "EXDEV" / "errno 18" 这类底层术语。
  const tip = isCrossDevice
    ? "应用安装目录与系统临时目录不在同一个磁盘分区。请尝试把 Agno Desktop 移动到 ~/Applications，或在「设置」页手动重试。"
    : "更新失败。点击「重试」或在「设置」页查看详情。";

  return (
    <div
      data-tauri-drag-region={false}
      role="alert"
      aria-live="polite"
      className="flex items-center gap-1.5"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1 text-[11px] text-destructive/90 select-none">
            <AlertTriangle className="h-3 w-3" />
            <span>更新失败</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[11px] max-w-[320px]">
          {tip}
          {error && (
            <div className="mt-1 font-mono text-[10px] text-muted-foreground break-all">
              {error.length > 200 ? error.slice(0, 200) + "…" : error}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
      <Button
        size="sm"
        variant="ghost"
        data-tauri-drag-region={false}
        onClick={() => void onRetry()}
        aria-label="重试检查更新"
        className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground shadow-none"
      >
        <RotateCcw className="h-3 w-3 mr-1" />
        重试
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * 下载进度指示器
 *
 * 视觉层级：
 *   ① spinner （左侧，h-3）
 *   ② 进度条   （48px × 4px，accent 色填充；total 未知时用 shimmer）
 *   ③ 文字     （"正在下载 v0.0.5"，11px，muted）
 *   ④ 百分比   （"37%"，11px，mono + tabular-nums 防止抖动）
 *
 * 边界处理：
 * - downloaded=0 + total>0：percent=0 此时不渲染（避免「0% 闪一下」的违和感）
 * - total=null/unknown：渲染 shimmer 动效作为"未知总量"信号
 * - info=null（理论上 install() 阶段不应发生，但 hook 转换的瞬间可能 race）：
 *   fallback 到"正在下载更新"文案，不让 title bar 突然空白
 * - downloaded > total：clamp 到 100%
 * ---------------------------------------------------------------- */

interface DownloadIndicatorProps {
  infoVersion: string | undefined;
  downloaded: number;
  total: number | null;
}

// 单独 export 是为了让测试文件能直接拿这个组件做 SSR 测试；
// 业务代码仍按默认 import（见 import 列表）。
/* oxlint-disable-next-line react/no-children-prop */
export function DownloadIndicator({
  infoVersion,
  downloaded,
  total,
}: DownloadIndicatorProps) {
  const hasTotal = typeof total === "number" && total > 0;
  const percent = hasTotal
    ? Math.min(100, Math.round((downloaded / total) * 100))
    : null;
  // 0% 在第一帧没有任何 chunk 到达时会出现，看起来像「卡住了」。
  // 至少要有 1% 才显示百分比，让「下载刚启动」的视觉过渡更自然。
  const showPercent = percent !== null && percent > 0;

  return (
    <div
      data-tauri-drag-region={false}
      role="status"
      aria-live="polite"
      aria-label={
        hasTotal && percent !== null
          ? `正在下载更新 v${infoVersion ?? ""}，已完成 ${percent}%`
          : `正在下载更新 v${infoVersion ?? ""}`
      }
      className="flex items-center gap-2 text-[11px] text-muted-foreground select-none"
    >
      <Loader2 className="h-3 w-3 animate-spin text-accent shrink-0" />

      {/* 内联进度条：48px × 4px，accent 色填充 */}
      <div
        className="relative h-1 w-12 rounded-full bg-muted-foreground/15 overflow-hidden"
        aria-hidden="true"
      >
        {hasTotal ? (
          <div
            className="absolute inset-y-0 left-0 bg-accent rounded-full transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        ) : (
          // total 未知：用现有的 shimmer 工具类做"扫描"动效
          // （index.css 里 .shimmer-bg 已经定义好动画）
          <div className="absolute inset-0 shimmer-bg rounded-full" />
        )}
      </div>

      <span className="whitespace-nowrap">
        正在下载
        {infoVersion && (
          <span className="text-foreground/85 font-medium ml-1">
            v{infoVersion}
          </span>
        )}
      </span>
      {showPercent && (
        <span className="font-mono tabular-nums text-foreground/80 whitespace-nowrap">
          {percent}%
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * 重启按钮
 *
 * 设计取舍：
 * - size=sm + h-6 让按钮高度对齐 28pt 标题栏，视觉上「贴在标题栏里」
 *   而不是「浮在内容上方」。
 * - 加 Tooltip：titlebar 文字只有「重启」二字，用户可能需要 hover 看到
 *   「重启应用以应用 v0.0.5 更新」完整说明。
 * - data-tauri-drag-region={false} 显式覆盖父容器的 drag 行为，
 *   让 click 一定到达 button（Tauri 2 不会自动从 button 上取消 drag）。
 * ---------------------------------------------------------------- */

interface RestartButtonProps {
  version: string;
  onRestart: () => void;
}

function RestartButton({ version, onRestart }: RestartButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          variant="default"
          data-tauri-drag-region={false}
          onClick={onRestart}
          aria-label={`重启应用以应用 v${version} 更新`}
          className={cn(
            "h-6 px-2.5 text-[11px]",
            // 标题栏背景是半透明的，按钮默认 shadow-sm 显得突兀——
            // 关掉阴影 + 加大字重让它在 28pt 高 bar 里更显眼
            "shadow-none font-medium",
            "bg-accent text-accent-foreground hover:bg-accent/90"
          )}
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          重启
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="font-mono text-[11px]">
        重启应用以应用 v{version} 更新
      </TooltipContent>
    </Tooltip>
  );
}