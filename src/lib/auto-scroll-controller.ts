export type AutoScrollMode = "sticky" | "user-paused" | "auto-snapping";

export interface AutoScrollOptions {
  /** 距底 < threshold 视为"接近底部"（sticky）。默认 80px */
  threshold?: number;
  /** 程序触发 scroll 后，scroll 事件被识别为"自动的"的时间窗。默认 1500ms */
  markAutoMs?: number;
}

export interface ScrollSignal {
  distToBottom: number;
  now: number;
}

export interface WheelSignal {
  deltaY: number;
  /** 事件源头（用于判断是否在 [data-scrollable] 嵌套元素内） */
  target: EventTarget | null;
}

/**
 * 纯逻辑状态机；不依赖 React / DOM。
 *
 * 状态：
 *   - `sticky`          → 跟随模式：新内容进来时容器自动滚到底
 *   - `user-paused`     → 用户已滚离底部，停下来不自动追
 *   - `auto-snapping`   → 我们刚刚程序触发了 scrollToBottom，
 *                         在 markAutoMs 时间窗内忽略 scroll 事件（避免
 *                         自己触发的 scroll 被误判为"用户滚了"）
 *
 * 事件：
 *   - `handleScroll(signal)` → 容器 scroll 事件
 *   - `handleWheel(signal)`  → 滚轮事件（仅向上滚算用户主动行为）
 *   - `jumpToBottom(now)`    → 程序触发 snap
 *   - `pause()`              → 手动切到 user-paused（不受 sticky 自动恢复）
 *   - `resume(now)`          → 等价 jumpToBottom
 *
 * 借鉴自 OpenCode 的 createAutoScroll：
 *   https://github.com/anomalyco/opencode/blob/main/packages/ui/src/hooks/create-auto-scroll.tsx
 * 简化为单一状态字段 + 三个事件，避免原版多字段模式在 React 里易出错。
 */
export class AutoScrollController {
  private _mode: AutoScrollMode = "sticky";
  private snapUntil = 0;
  private readonly threshold: number;
  private readonly markAutoMs: number;

  constructor(options: AutoScrollOptions = {}) {
    this.threshold = options.threshold ?? 80;
    this.markAutoMs = options.markAutoMs ?? 1500;
  }

  get mode(): AutoScrollMode {
    return this._mode;
  }

  isSticky(): boolean {
    return this._mode === "sticky";
  }

  /**
   * 滚轮事件：只把"向上滚"视作用户主动行为。
   * 嵌套可滚动区域 [data-scrollable] 内的滚轮不触发 pause。
   */
  handleWheel(signal: WheelSignal): boolean {
    if (signal.deltaY >= 0) return false;
    if (signal.target && isInsideScrollable(signal.target)) return false;
    if (this._mode === "sticky") {
      this._mode = "user-paused";
      return true;
    }
    return false;
  }

  /**
   * 容器 scroll 事件。
   *
   * - auto-snapping 窗口内的 scroll 事件被吞掉（避免自触发被误判）
   * - 接近底部 → 自动恢复 sticky（覆盖 wheel 引起的 pause）
   * - 远离底部 + 当前 sticky → 切 user-paused
   */
  handleScroll(signal: ScrollSignal): boolean {
    if (this._mode === "auto-snapping") {
      if (signal.now < this.snapUntil) {
        if (signal.distToBottom < this.threshold) {
          this._mode = "sticky";
          return true;
        }
        return false;
      }
      this._mode =
        signal.distToBottom < this.threshold ? "sticky" : "user-paused";
      return true;
    }

    const isClose = signal.distToBottom < this.threshold;
    if (isClose && this._mode === "user-paused") {
      this._mode = "sticky";
      return true;
    }
    if (!isClose && this._mode === "sticky") {
      this._mode = "user-paused";
      return true;
    }
    return false;
  }

  /** 程序触发 snap：返回 snap 窗口的结束时间（epoch ms），便于联调。 */
  jumpToBottom(now: number): number {
    this._mode = "auto-snapping";
    this.snapUntil = now + this.markAutoMs;
    return this.snapUntil;
  }

  /** 手动 pause（键盘导航 / 用户主动取消跟随） */
  pause(): boolean {
    if (this._mode === "user-paused") return false;
    this._mode = "user-paused";
    return true;
  }

  /** 手动 resume —— 等价于 jumpToBottom。 */
  resume(now: number): number {
    return this.jumpToBottom(now);
  }
}

function isInsideScrollable(target: EventTarget): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return !!(target as Element).closest("[data-scrollable]");
}