"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type UIEvent,
  type WheelEvent,
} from "react";
import { AutoScrollController } from "../lib/auto-scroll-controller";

export interface UseAutoScrollOptions {
  enabled?: boolean;
  threshold?: number;
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

    let lastScrollHeight = el.scrollHeight;
    let pending = false;

    const tick = () => {
      pending = false;
      const c = controllerRef.current;
      if (!c || !c.isSticky()) return;
      const root = scrollRef.current;
      if (!root) return;
      if (root.scrollHeight === lastScrollHeight) return;
      lastScrollHeight = root.scrollHeight;
      c.jumpToBottom(Date.now());
      root.scrollTop = root.scrollHeight;
    };
    const schedule = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(tick);
    };

    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    const mo = new MutationObserver(schedule);
    mo.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });

    return () => {
      ro.disconnect();
      mo.disconnect();
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
