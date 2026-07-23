/**
 * tests/auto-scroll-controller.test.ts — src/lib/auto-scroll-controller.ts
 *
 * 状态机逻辑纯函数测试；无 DOM、无 React、不依赖测试基础设施。
 * 覆盖：sticky / user-paused / auto-snapping 三态转移 + markAuto 窗口
 * + 嵌套 [data-scrollable] 过滤 + pause / resume。
 */
import { AutoScrollController } from "../src/lib/auto-scroll-controller";

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.log(`✗ ${msg}`);
    failed++;
  }
}

interface FakeElement {
  closest(selector: string): FakeElement | null;
  hasAttribute(name: string): boolean;
}

function makeFakeElement(opts: {
  scrollable?: boolean;
  parent?: FakeElement | null;
}): FakeElement {
  const el: FakeElement = {
    hasAttribute(name) {
      return opts.scrollable === true && name === "data-scrollable";
    },
    closest(selector) {
      if (selector === "[data-scrollable]") {
        if (this.hasAttribute("data-scrollable")) return this;
        return opts.parent ? opts.parent.closest(selector) : null;
      }
      return null;
    },
  };
  return el;
}

function main(): void {
  console.log("=== AutoScrollController: 初始状态 ===");
  {
    const c = new AutoScrollController();
    assert(c.mode === "sticky", "默认 mode = sticky");
    assert(c.isSticky() === true, "isSticky() 默认 true");
  }

  console.log("=== handleScroll: 接近底部恢复 sticky ===");
  {
    const c = new AutoScrollController({ threshold: 80 });
    // 先让用户滚走
    c.handleScroll({ distToBottom: 200, now: 1000 });
    assert(c.mode === "user-paused", "滚到底部下方 → user-paused");
    // 再滚回接近底部
    const changed = c.handleScroll({ distToBottom: 50, now: 1100 });
    assert(changed === true, "回到接近底部时 handleScroll 返回 true（state 变化）");
    assert(c.mode === "sticky", "回到接近底部 → sticky");
  }

  console.log("=== handleScroll: 远离底部触发 pause ===");
  {
    const c = new AutoScrollController({ threshold: 80 });
    const changed = c.handleScroll({ distToBottom: 200, now: 1000 });
    assert(changed === true, "从 sticky 滚走时返回 true");
    assert(c.mode === "user-paused", "→ user-paused");
    // 再次滚走，不应再变
    const changed2 = c.handleScroll({ distToBottom: 300, now: 1100 });
    assert(changed2 === false, "已在 user-paused 时再次远离底部 → 不变（false）");
  }

  console.log("=== markAuto 窗口: jumpToBottom 后的 scroll 事件被吞掉 ===");
  {
    const c = new AutoScrollController({ threshold: 80, markAutoMs: 1500 });
    const until = c.jumpToBottom(1000);
    assert(until === 2500, "jumpToBottom 返回 snapUntil = now + markAutoMs");
    assert(c.mode === "auto-snapping", "jumpToBottom 后 → auto-snapping");
    // 在窗口内、远离底部 → 应忽略，不切到 user-paused
    const ignored = c.handleScroll({ distToBottom: 500, now: 2000 });
    assert(ignored === false, "snap 窗口内远离底部的 scroll → 忽略（false）");
    assert(c.mode === "auto-snapping", "snap 窗口内 mode 不变");
    // 在窗口内、接近底部 → 应直接 snap 回 sticky
    const snapped = c.handleScroll({ distToBottom: 10, now: 2200 });
    assert(snapped === true, "snap 窗口内接近底部 → 切回 sticky（true）");
    assert(c.mode === "sticky", "snap 窗口内接近底部 → sticky");
  }

  console.log("=== markAuto 窗口过期后正常处理 ===");
  {
    const c = new AutoScrollController({ threshold: 80, markAutoMs: 1000 });
    c.jumpToBottom(1000);
    // 窗口已过期（now > 2000）
    const changed = c.handleScroll({ distToBottom: 500, now: 3000 });
    assert(changed === true, "snap 窗口过期后的 scroll → 正常触发 pause");
    assert(c.mode === "user-paused", "→ user-paused");
  }

  console.log("=== handleWheel: 向下滚不算用户行为 ===");
  {
    const c = new AutoScrollController();
    const changed = c.handleWheel({ deltaY: 50, target: null });
    assert(changed === false, "deltaY >= 0（向下滚）→ false");
    assert(c.mode === "sticky", "向下滚不切 mode");
  }

  console.log("=== handleWheel: 向上滚触发 pause ===");
  {
    const c = new AutoScrollController();
    const changed = c.handleWheel({ deltaY: -30, target: null });
    assert(changed === true, "deltaY < 0（向上滚）→ true");
    assert(c.mode === "user-paused", "向上滚 → user-paused");
    // 再向上滚，mode 不再变
    const changed2 = c.handleWheel({ deltaY: -30, target: null });
    assert(changed2 === false, "已在 user-paused 时再向上滚 → false");
  }

  console.log("=== handleWheel: 嵌套 [data-scrollable] 不触发 ===");
  {
    const c = new AutoScrollController();
    const outer = makeFakeElement({});
    const inner = makeFakeElement({ scrollable: true, parent: outer });
    const changed = c.handleWheel({ deltaY: -30, target: inner });
    assert(changed === false, "嵌套 [data-scrollable] 内向上滚 → false");
    assert(c.mode === "sticky", "嵌套滚动不切 mode");
  }

  console.log("=== pause / resume ===");
  {
    const c = new AutoScrollController();
    const changed = c.pause();
    assert(changed === true, "pause() 从 sticky 切 user-paused → true");
    assert(c.mode === "user-paused", "pause 后 mode = user-paused");
    const changed2 = c.pause();
    assert(changed2 === false, "已在 user-paused 时 pause() → false");
    const until = c.resume(5000);
    assert(until === 6500, "resume(5000) → snapUntil = 6500（默认 1500ms）");
    assert(c.mode === "auto-snapping", "resume() → auto-snapping");
  }

  console.log("=== threshold 自定义 ===");
  {
    const c = new AutoScrollController({ threshold: 200 });
    c.handleScroll({ distToBottom: 150, now: 1000 });
    assert(c.mode === "sticky", "distToBottom=150 < threshold=200 → 仍 sticky");
    c.handleScroll({ distToBottom: 250, now: 1100 });
    assert(c.mode === "user-paused", "distToBottom=250 >= threshold → user-paused");
  }
}

main();
if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
} else {
  console.log("\nall assertions passed");
}