import { useVirtualizer } from "@tanstack/react-virtual";
import type { ChatMessage } from "@/lib/message-types";
import { MessageBubble } from "./MessageBubble";
import { Loader2 } from "lucide-react";

interface Props {
  messages: ChatMessage[];
  /** TanStack's scroll element (the parent overflow-y-auto div). */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** 历史正在拉取 → 在末尾追加一个 spinner row */
  loadingHistory?: boolean;
}

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
 *
 * 容器结构（标准 TanStack Virtual）：
 *   <div ref={scrollRef} overflow-y-auto>
 *     <div style="height: totalSize; position: relative">
 *       {items.map(i =>
 *         <div style="position: absolute; top: 0; transform: translateY(i.start); height: i.size"
 *              ref={virtualizer.measureElement}>
 *           <MessageBubble message={messages[i.index]} />
 *         </div>
 *       )}
 *     </div>
 *   </div>
 *
 * 性能合约：
 *   - 长 session（1000+ 条消息）只渲染 viewport + overscan 内的行；
 *     之前是 messages.map → 全部挂载。
 *   - MessageBubble 仍 memo(message ref)；未变更 message 跳过 render。
 *   - streaming 期间增长 → ResizeObserver 测量新高度 → virtualizer 重算 layout，
 *     container 用 `scrollHeight` 检测 → useAutoScroll 自动 snap。
 */
export function VirtualMessageList({
  messages,
  scrollRef,
  loadingHistory = false,
}: Props) {
  const count = messages.length + (loadingHistory ? 1 : 0);

  const virtualizer = useVirtualizer<
    HTMLDivElement,
    HTMLDivElement
  >({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 80,
    overscan: 6,
    getItemKey: (index) => {
      if (loadingHistory && index === messages.length) return "__loading__";
      return messages[index]?.id ?? `missing:${index}`;
    },
  });

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
        return (
          <div
            key={vi.key}
            data-index={vi.index}
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
              <MessageBubble message={messages[vi.index]!} />
            )}
          </div>
        );
      })}
    </div>
  );
}