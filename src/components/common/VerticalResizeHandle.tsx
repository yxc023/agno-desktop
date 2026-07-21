/**
 * VerticalResizeHandle — 共享的"垂直方向拖动调整宽度"把手
 *
 * 复用于：
 * - ChatPage 的 sessions 栏 / 右侧 InstancesPanel 栏分隔
 * - AppShell 的主侧栏 / 主区域分隔
 *
 * 设计原则（沿用 ChatPage 的成熟实现）：
 * - 1px 边框作为视觉锚点；hover 时变 accent/40 给一点 affordance
 * - 命中区扩到 -left-1 -right-1（8px 范围）让鼠标更容易命中
 * - 双击触发重置（外部传入 callback）
 * - onMouseDown 同步设 body.userSelect / cursor，不依赖 useEffect
 *
 * 与 useColumnResize hook 配合使用：state 决定是否处于拖动中，
 * 拖动期间的 mousemove / mouseup 由 useColumnResize hook 处理。
 */
import * as React from "react";

interface Props {
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onMouseUp?: () => void;
  /** ARIA label，便于屏幕阅读器读出"拖动调整 xx 栏宽度" */
  ariaLabel: string;
}

export function VerticalResizeHandle({
  onMouseDown,
  onDoubleClick,
  onMouseUp,
  ariaLabel,
}: Props) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      title="拖动调整宽度 · 双击重置"
      onMouseDown={(e) => {
        // 阻止浏览器默认行为：从 mousedown 那一刻起的文本选择
        e.preventDefault();
        // 同步设上 user-select / cursor，不依赖 useEffect（避免"先选了一段
        // 字才进 drag 模式"的闪烁）。mouseup 时由调用方清掉这两个值。
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";
        onMouseDown(e);
      }}
      onDoubleClick={onDoubleClick}
      onMouseUp={onMouseUp}
      className="relative w-px shrink-0 select-none cursor-col-resize bg-border hover:bg-accent/40"
    >
      {/* hit area: 扩大到 -left-1 -right-1，让 8px 范围内都能命中 */}
      <div className="pointer-events-none absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}
