/**
 * TimelineCache — 跨 session 切换 / 跨 tab 复用虚拟化器测量。
 *
 * 用法（参考 OpenCode packages/app/src/pages/session/timeline/message-timeline.tsx:90）：
 *   - VirtualMessageList onMount: cache.get(sessionId)?.measurements ?? []
 *     → 作为 useVirtualizer 的 initialMeasurements，传给 TanStack Virtual
 *   - VirtualMessageList onCleanup: cache.set(sessionId, virtualizer.measurementsCache)
 *     → 下次切回这个 session 时不用从 60px fallback 重测
 *
 * LRU 语义：超出 max 时淘汰最久未访问的 key。Map 保留插入顺序，
 * delete-then-set 把 key 推到队尾 → "最久未访问" = 队首。
 */

export interface TimelineCacheEntry<T> {
  measurements: T[];
  scrollOffset?: number;
}

export class TimelineCache<T> {
  private store = new Map<string, TimelineCacheEntry<T>>();
  private readonly max: number;

  constructor(max = 16) {
    this.max = max;
  }

  get(key: string): TimelineCacheEntry<T> | undefined {
    return this.store.get(key);
  }

  set(key: string, entry: TimelineCacheEntry<T>): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    }
    this.store.set(key, entry);
    if (this.store.size > this.max) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}