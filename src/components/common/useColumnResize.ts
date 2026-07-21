/**
 * useColumnResize — 共享的"列宽拖动"hook
 *
 * 把 ChatPage 的 drag/dx/clamp/persist 那一坨 useEffect 抽出来。
 *
 * 用法：
 *   const { width, dragHandlers, persistNow } = useColumnResize({
 *     initial: 260,
 *     min: 200,
 *     max: 480,
 *     direction: "right",
 *     persist: (w) => updateSettings({ chatSessionsWidth: w }),
 *   });
 *   <aside style={{ width }}>...</aside>
 *   <VerticalResizeHandle {...dragHandlers} onMouseUp={persistNow} />
 *
 * 设计要点：
 * - drag state 用 React state（不是 ref）：ref 变化不触发 useEffect 重新挂
 *   监听器，导致"onMouseDown 后永远进不到 move"——这是 ChatPage 早期 bug 的
 *   root cause，注释里也提过。沿用同样的修法。
 * - 拖动期间由 VerticalResizeHandle 在 mousedown 时同步加 userSelect/cursor，
 *   mouseup 时由本 hook 在 cleanup 里清掉。
 * - persist 用 ref 缓存最新版宽，外部可以在 onMouseUp 时一次性写回 store，
 *   避免拖动过程中每次 move 都触发整个 settings re-render。
 *
 * direction：
 *   - "right"（默认）：拖动 dx 越大，列越宽 —— 适用于"列在拖动方向左侧"，
 *     比如左边的 sidebar、右栏的左边沿往左拖（ChatPage 的 sessions 栏）
 *   - "left"：拖动 dx 越大，列越窄 —— 适用于"列在拖动方向右侧"，
 *     比如右栏的左边沿往右拖（ChatPage 的 InstancesPanel）
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { clampWidth } from "@/lib/utils";

export type ResizeDirection = "right" | "left";

export interface UseColumnResizeOptions {
  initial: number;
  min: number;
  max: number;
  direction?: ResizeDirection;
  persist?: (width: number) => void;
}

export function useColumnResize({
  initial,
  min,
  max,
  direction = "right",
  persist,
}: UseColumnResizeOptions) {
  const [width, setWidth] = useState(() => clampWidth(initial, min, max));
  const [drag, setDrag] = useState<DragState | null>(null);

  const widthRef = useRef(width);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  useEffect(() => {
    if (!drag) return;
    const { startX, startWidth } = drag;
    const sign = direction === "right" ? 1 : -1;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      setWidth(clampWidth(startWidth + sign * dx, min, max));
    };
    const onUp = () => setDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [drag, direction, min, max]);

  const dragHandlers = {
    onMouseDown: (e: React.MouseEvent) =>
      setDrag({ startX: e.clientX, startWidth: width }),
    onDoubleClick: () => {
      const next = initial;
      setWidth(clampWidth(next, min, max));
      persist?.(next);
    },
  };

  const persistNow = useCallback(() => persist?.(widthRef.current), [persist]);

  return {
    width,
    setWidth,
    dragHandlers,
    persist: persistNow,
  };
}

interface DragState {
  startX: number;
  startWidth: number;
}
