export interface PacedValueOptions {
  /** 每 tick 最小间隔 (ms)。默认 24 */
  paceMs?: number;
  /** 短于此字符数的差异直接同步释放，不节流。默认 512 */
  immediateThreshold?: number;
  /** 自定义 snap 边界字符（默认空白 + 中英常用标点） */
  snapChars?: string;
  /** 自定义 chunk 大小函数；返回"这一 tick 目标前进多少字符"。默认按 remaining 自适应。 */
  step?: (remaining: number) => number;
}

/**
 * 节流释放一个快速增长的值（典型场景：流式 markdown 文本）。
 *
 * 策略：
 *   - diff ≤ immediateThreshold 或非 live → 同步释放，不延迟
 *   - diff > immediateThreshold + live → 每 paceMs 释放一块
 *   - 每块大小由 step(remaining) 决定；末尾 snap 到最近的 snapChars
 *     （避免"半截 token"，例如 "cons" 中途显示成完整词）
 *   - 倒退 / 重写（latest 不以 shown 为前缀）→ 同步跟上，不走节流
 *
 * 设计借鉴 OpenCode `createPacedValue`（packages/ui/src/hooks/...）
 * 抽成"无 React 的纯类"以便测试，React 包装见 src/hooks/use-paced-value.ts。
 */
export class PacedValueController {
  private shown: string;
  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  private readonly paceMs: number;
  private readonly immediateThreshold: number;
  private readonly snapChars: string;
  private readonly stepFn: (remaining: number) => number;

  constructor(initial: string, options: PacedValueOptions = {}) {
    this.shown = initial;
    this.paceMs = options.paceMs ?? 24;
    this.immediateThreshold = options.immediateThreshold ?? 512;
    this.snapChars = options.snapChars ?? " \n\r\t.,!?;:)]}\"“”";
    this.stepFn = options.step ?? defaultStep;
  }

  get current(): string {
    return this.shown;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 把上游最新值推进 controller；按上述策略决定同步释放还是排队下一 tick。
   */
  push(latest: string, isLive: boolean): void {
    if (latest === this.shown) {
      this.pending = null;
      return;
    }
    if (!latest.startsWith(this.shown)) {
      this.shown = latest;
      this.pending = null;
      this.notify();
      return;
    }

    const diff = latest.length - this.shown.length;
    if (!isLive || diff <= this.immediateThreshold) {
      this.shown = latest;
      this.pending = null;
      this.notify();
      return;
    }

    this.pending = latest;
    if (this.timer === null) this.schedule();
  }

  /** 停止计时器并清空订阅（组件卸载时调） */
  destroy(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.listeners.clear();
    this.pending = null;
  }

  private schedule(): void {
    this.timer = setTimeout(() => this.tick(), this.paceMs);
  }

  /** 单步推进一 tick。仅供测试同步驱动，生产路径走 setTimeout。 */
  tick(): void {
    this.timer = null;
    const target = this.pending;
    if (target === null) return;

    const next = this.snapNext(target);
    this.shown = next;
    this.notify();

    if (this.shown.length >= target.length) {
      this.pending = null;
    } else {
      this.schedule();
    }
  }

  private snapNext(target: string): string {
    const start = this.shown.length;
    const remaining = target.length - start;
    if (remaining <= 0) return this.shown;

    const desired = start + this.stepFn(remaining);
    if (desired >= target.length) return target;

    const upperBound = Math.min(desired + 8, target.length);
    const snapSet = new Set(this.snapChars);
    for (let i = upperBound; i > desired; i--) {
      if (snapSet.has(target[i - 1] ?? "")) {
        return target.slice(0, i);
      }
    }
    return target.slice(0, desired);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}

/**
 * OpenCode 风格的 chunk 阶梯：
 *   - remaining > 4096 → 每 tick 256 chars（开始时大跨步）
 *   - remaining > 1024 → 128
 *   - remaining > 256  → 64
 *   - remaining > 64   → 16
 *   - 其余             → 4（接近末尾时细颗粒）
 */
function defaultStep(remaining: number): number {
  if (remaining > 4096) return 256;
  if (remaining > 1024) return 128;
  if (remaining > 256) return 64;
  if (remaining > 64) return 16;
  return 4;
}