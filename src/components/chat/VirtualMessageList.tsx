import { useEffect, useRef } from "react";
import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import type { ChatMessage } from "@/lib/message-types";
import { MessageBubble } from "./MessageBubble";
import { Loader2 } from "lucide-react";
import { TimelineCache } from "@/lib/timeline-cache";

interface Props {
  messages: ChatMessage[];
  /** TanStack's scroll element (the parent overflow-y-auto div). */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** 历史正在拉取 → 在末尾追加一个 spinner row */
  loadingHistory?: boolean;
  /**
   * 跨 mount 复用的缓存 key —— 切走再切回同一个 session 时，
   * 用之前测量的 row heights 跳过 80px fallback → ResizeObserver 重测的抖动。
   * 一般传 `${sessionId}:${agentId}`。
   */
  cacheKey?: string;
  /**
   * 当这个 id 变化时，把对应 message 滚到视口中央。用于 hash 跳转 / 深链。
   * 找不到对应 message 时 no-op（消息可能还没加载回来）。
   */
  scrollToMessageId?: string;
  /**
   * 当 topmost 可见 message 变化（debounced 150ms）时回调；用于把当前
   * "active message" 写到 URL hash。topmost 在 viewport 顶部 ±80px 区间内取。
   * 组件 unmount / hash 跳转期间不触发回调（避免循环）。
   */
  onActiveMessageChange?: (messageId: string | null) => void;
}

const measurementCache = new TimelineCache<VirtualItem>(16);

/**
 * VirtualMessageList — 虚拟化消息列表。
 *
 * 设计：
 *   - count = messages.length + (loadingHistory ? 1 : 0)
 *   - estimateSize 80px fallback（ResizeObserver 会重新测量）
 *   - overscan 6：滚动时多渲染 6 行避免白屏
 *   - getItemKey 用 message.id（稳定 key，React.memo 命中）
 *   - transform 模式（默认）：item 用 transform: translateY 定位，浏览器
 *     单独 layer 渲染，滚动时不会触发 layout
 *   - 跨 mount：TimelineCache 缓存 measurements；切回同 session 跳过 80px fallback
 *   - hash 跳转：scrollToMessageId 变化时 scrollToIndex(center)
 *   - active 跟踪：topmost 可见 row 变化时回调（debounced 150ms）
 *
 * 容器结构（标准 TanStack Virtual）：
 *   <div ref={scrollRef} overflow-y-auto>
 *     <div style="height: totalSize; position: relative">
 *       {items.map(i =>
 *         <div data-message-id={messages[i.index]?.id}
 *              style="position: absolute; transform: translateY(i.start); height: i.size"
 *              ref={virtualizer.measureElement}>
 *           <MessageBubble message={messages[i.index]} />
 *         </div>
 *       )}
 *     </div>
 *   </div>
 *
 * 性能合约：
 *   - 长 session（1000+ 条消息）只渲染 viewport + overscan 内的行
 *   - MessageBubble 仍 memo(message ref)；未变更 message 跳过 render
 *   - streaming 增长 → ResizeObserver 测量新高度 → virtualizer 重算 layout
 */
export function VirtualMessageList({
  messages,
  scrollRef,
  loadingHistory = false,
  cacheKey,
  scrollToMessageId,
  onActiveMessageChange,
}: Props) {
  const count = messages.length + (loadingHistory ? 1 : 0);
  const virtualizerRef = useRef<ReturnType<
    typeof useVirtualizer<HTMLDivElement, HTMLDivElement>
  > | null>(null);

  // 注入缓存的 measurements（仅首次挂载读一次；cacheKey 变化触发 remount 由父组件
  // 通过 React key 控制）。TanStack 的 initialMeasurements 只在 hook 构造时读一次。
  const initialMeasurements = (() => {
    if (!cacheKey) return undefined;
    return measurementCache.get(cacheKey)?.measurements;
  })();

  const virtualizer = useVirtualizer<
    HTMLDivElement,
    HTMLDivElement
  >({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 80,
    overscan: 6,
    initialMeasurementsCache: initialMeasurements,
    getItemKey: (index) => {
      if (loadingHistory && index === messages.length) return "__loading__";
      return messages[index]?.id ?? `missing:${index}`;
    },
  });

  virtualizerRef.current = virtualizer;

  // 卸载时：把当前 measurements 写回缓存
  useEffect(() => {
    if (!cacheKey) return;
    return () => {
      const v = virtualizerRef.current;
      if (!v) return;
      const snapshot = v.measurementsCache;
      measurementCache.set(cacheKey, { measurements: [...snapshot] });
    };
  }, [cacheKey]);

  // hash 跳转：scrollToMessageId 变化时 scrollToIndex
  //
  // 多帧 rAF polling：TanStack 第一次 mount 后还要等 row 测量完才能
  // 准确定位；如果消息很靠下（offscreen），第一次 scrollToIndex 走估计高度，
  // 等 row 真正渲染后会跳一下。这里最多轮询 8 帧（≈135ms），找到 row
  // 已渲染 + 已测量后再 scrollToIndex。
  //
  // scrolledRef 防止同 target 在 streaming 期间 messages 数组每次更新
  // 时被重新滚动（effect deps 含 messages，会一直触发）。
  const scrolledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!scrollToMessageId) return;
    if (scrolledRef.current === scrollToMessageId) return;
    const idx = messages.findIndex((m) => m.id === scrollToMessageId);
    if (idx < 0) return; // 消息还没加载回来，no-op；等下次 messages 更新

    let frames = 0;
    let raf = 0;
    const targetId = scrollToMessageId;
    function tryScroll() {
      const root = scrollRef.current;
      if (!root) return;
      const row = root.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(targetId)}"]`
      );
      // row 已渲染 + 已测量（高度 > 0）→ scroll
      if (row && row.offsetHeight > 0) {
        virtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" });
        scrolledRef.current = targetId;
        return;
      }
      if (frames++ < 8) {
        raf = requestAnimationFrame(tryScroll);
      } else {
        // 超时：兜底用估计高度 scrollToIndex
        virtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" });
        scrolledRef.current = targetId;
      }
    }
    raf = requestAnimationFrame(tryScroll);
    return () => cancelAnimationFrame(raf);
  }, [scrollToMessageId, messages, virtualizer, scrollRef]);

  // topmost 可见 message 跟踪（debounced 150ms）
  useEffect(() => {
    if (!onActiveMessageChange) return;
    const cb = onActiveMessageChange;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastId: string | null = null;

    function findTopmostId(): string | null {
      const root = scrollRef.current;
      if (!root) return null;
      const rows = root.querySelectorAll<HTMLElement>("[data-message-id]");
      const rootRect = root.getBoundingClientRect();
      const targetY = rootRect.top + 80;
      let best: { id: string; dist: number } | null = null;
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (rect.bottom < rootRect.top) continue;
        if (rect.top > targetY) continue;
        const id = row.dataset.messageId;
        if (!id) continue;
        const dist = Math.abs(rect.top - targetY);
        if (best === null || dist < best.dist) best = { id, dist };
      }
      return best?.id ?? null;
    }

    function schedule() {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        const id = findTopmostId();
        if (id !== lastId) {
          lastId = id;
          cb(id);
        }
      }, 150);
    }

    const root = scrollRef.current;
    if (!root) return;
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: false });
    schedule();
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, [onActiveMessageChange, scrollRef]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        position: "relative",
        width: "100%",
      }}
    >
      {virtualItems.map((vi) => {
        const isLoadingRow =
          loadingHistory && vi.index === messages.length;
        const message = messages[vi.index];
        return (
          <div
            key={vi.key}
            data-index={vi.index}
            data-message-id={message?.id}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${vi.start}px)`,
            }}
          >
            {isLoadingRow ? (
              <div className="mx-auto flex max-w-4xl justify-center py-4">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <MessageBubble message={message!} />
            )}
          </div>
        );
      })}
    </div>
  );
}