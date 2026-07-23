import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type UIEvent,
  type WheelEvent,
} from "react";
import { AutoScrollController } from "@/lib/auto-scroll-controller";

export interface UseAutoScrollOptions {
  /** 是否启用"内容增长自动 snap 到底"。默认 true */
  enabled?: boolean;
  /** 距底阈值（px），< 即视为接近底部。默认 80 */
  threshold?: number;
  /** 程序触发 scroll 后自我识别的窗口（ms）。默认 1500 */
  markAutoMs?: number;
}

export interface UseAutoScrollReturn {
  scrollRef: RefObject<HTMLDivElement | null>;
  stickToBottom: boolean;
  jumpToBottom: (smooth?: boolean) => void;
  pause: () => void;
  resume: () => void;
  onScroll: (e: UIEvent<HTMLDivElement>) => void;
  onWheel: (e: WheelEvent<HTMLDivElement>) => void;
}

/**
 * 聊天的"自动跟随新内容 / 用户滚走则停下"状态机 hook。
 *
 * 关键设计（借鉴 OpenCode createAutoScroll，并按 React 简化）：
 *   1. `markAuto` 窗口 —— jumpToBottom 后 markAutoMs 内收到的 scroll 事件
 *      不会被误判为用户主动滚动；
 *   2. `overflow-anchor` 动态切换 —— sticky 时设 `none`，让浏览器原生 anchor
 *      别和我们的 snap 打架；user-paused 时设回 `auto`；
 *   3. wheel 向上滚 → pause；嵌套 `[data-scrollable]` 内的滚轮不算；
 *   4. `ResizeObserver` 监听容器尺寸变化，sticky 时在 rAF 内 snap；
 *   5. `stickToBottom` 是 React state —— 仅在状态切换时触发 render，
 *      滚动事件本身不会引起 React 重渲染。
 */
export function useAutoScroll(
  options: UseAutoScrollOptions = {}
): UseAutoScrollReturn {
  const { enabled = true, threshold = 80, markAutoMs = 1500 } = options;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<AutoScrollController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new AutoScrollController({ threshold, markAutoMs });
  }
  const [stickToBottom, setStickToBottom] = useState(true);

  const syncState = useCallback(() => {
    const c = controllerRef.current!;
    setStickToBottom((prev) => (prev === c.isSticky() ? prev : c.isSticky()));
  }, []);

  const onScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      const changed = controllerRef.current!.handleScroll({
        distToBottom: dist,
        now: Date.now(),
      });
      if (changed) syncState();
    },
    [syncState]
  );

  const onWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      const changed = controllerRef.current!.handleWheel({
        deltaY: e.deltaY,
        target: e.target,
      });
      if (changed) syncState();
    },
    [syncState]
  );

  const jumpToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    controllerRef.current!.jumpToBottom(Date.now());
    setStickToBottom(true);
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const pause = useCallback(() => {
    const changed = controllerRef.current!.pause();
    if (changed) setStickToBottom(false);
  }, []);

  const resume = useCallback(() => {
    jumpToBottom(true);
  }, [jumpToBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.style.overflowAnchor = stickToBottom ? "none" : "auto";
    return () => {
      el.style.overflowAnchor = "";
    };
  }, [stickToBottom]);

  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      const c = controllerRef.current!;
      if (!c.isSticky()) return;
      requestAnimationFrame(() => {
        if (!c.isSticky()) return;
        const root = scrollRef.current;
        if (!root) return;
        c.jumpToBottom(Date.now());
        root.scrollTop = root.scrollHeight;
      });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [enabled]);

  return {
    scrollRef,
    stickToBottom,
    jumpToBottom,
    pause,
    resume,
    onScroll,
    onWheel,
  };
}