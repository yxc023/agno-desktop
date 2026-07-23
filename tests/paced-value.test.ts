/**
 * tests/paced-value.test.ts — src/lib/paced-value.ts
 *
 * 节流释放逻辑纯类测试。用暴露的 tick() 同步驱动（不依赖 setTimeout 实跑）。
 * 覆盖：
 *   - 短 diff 同步释放 / 长 diff 排队
 *   - snap 到空白 / 标点
 *   - chunk 阶梯（remaining 越大，chunk 越大）
 *   - 倒退 / 重写（latest 不以 shown 为前缀）
 *   - !isLive 一次性跟上
 *   - 释放完 pending 清空、不再 schedule
 */
import { PacedValueController } from "../src/lib/paced-value";

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.log(`✗ ${msg}`);
    failed++;
  }
}

function main(): void {
  console.log("=== 同步释放: 短 diff ===");
  {
    const c = new PacedValueController("Hello");
    c.push("Hello world", true);
    assert(c.current === "Hello world", "diff=6 < 512 → 同步释放");
  }

  console.log("=== 节流释放: 长 diff ===");
  {
    const c = new PacedValueController("Hi");
    const long = "Hi " + "x".repeat(2000);
    c.push(long, true);
    assert(
      c.current === "Hi",
      "第一次 push 不立即释放（diff > 512），保留 shown = 'Hi'"
    );
    c.tick();
    assert(
      c.current.length > "Hi".length && c.current.length < long.length,
      "第一次 tick 释放了一部分但不是全部"
    );
    const firstTickLen = c.current.length;
    c.tick();
    assert(
      c.current.length > firstTickLen,
      "第二次 tick 又往前推了一段"
    );
  }

  console.log("=== 释放到底后停止 ===");
  {
    const c = new PacedValueController("");
    c.push("Hello world.", true);
    let safety = 50;
    while (c.current !== "Hello world." && safety-- > 0) c.tick();
    assert(c.current === "Hello world.", "最终追上 pending");
    const lenBefore = c.current.length;
    c.tick();
    assert(c.current.length === lenBefore, "无 pending → tick 是 no-op");
  }

  console.log("=== snap 到空白 ===");
  {
    const c = new PacedValueController("", {
      paceMs: 0,
      step: () => 4,
      immediateThreshold: 0,
    });
    c.push("abcdef ghij", true);
    c.tick();
    assert(
      c.current === "abcdef ",
      "step=4, target='abcdef ghij' → snap 到空白 → 'abcdef '（含空格）"
    );
  }

  console.log("=== snap 到标点 / 空白 ===");
  {
    const c = new PacedValueController("", {
      paceMs: 0,
      step: () => 4,
      immediateThreshold: 0,
    });
    c.push("hello, world", true);
    c.tick();
    assert(
      c.current === "hello, ",
      "step=4 → 在 [4,12] 倒序找 snap char → 空格在 index 7 → 'hello, '（含尾随空格）"
    );
  }

  console.log("=== 无 snap 时用 desired ===");
  {
    const c = new PacedValueController("", {
      paceMs: 0,
      step: () => 4,
      immediateThreshold: 0,
    });
    c.push("abcdefghij", true);
    c.tick();
    assert(
      c.current === "abcd",
      "无空白/标点 → 用 desired 位置 'abcd'"
    );
  }

  console.log("=== chunk 阶梯 ===");
  {
    const c = new PacedValueController("", { paceMs: 0, immediateThreshold: 0 });
    // remaining > 4096 → step 256
    const big = "x".repeat(5000);
    c.push(big, true);
    c.tick();
    assert(c.current.length === 256, "remaining=5000 → first tick 推 256 chars");
    // remaining < 64 → step 4
    const tiny = "y".repeat(60);
    const c2 = new PacedValueController("", { paceMs: 0, immediateThreshold: 0 });
    c2.push(tiny, true);
    c2.tick();
    assert(
      c2.current.length <= 4,
      "remaining=60 → first tick 推 ≤ 4 chars (snap 可能更短)"
    );
  }

  console.log("=== 倒退 / 重写: 同步跟上 ===");
  {
    const c = new PacedValueController("Hello world");
    c.push("Goodbye", true);
    assert(
      c.current === "Goodbye",
      "latest 不以 shown 为前缀（重写）→ 同步跟上"
    );
  }

  console.log("=== !isLive: 一次性追上 ===");
  {
    const c = new PacedValueController("Hi");
    const long = "Hi " + "x".repeat(2000);
    c.push(long, false);
    assert(
      c.current === long,
      "isLive=false → 即使 diff > 512 也同步释放"
    );
  }

  console.log("=== 倒退: pending 也要清 ===");
  {
    const c = new PacedValueController("Hi");
    c.push("Hi " + "x".repeat(2000), true);
    assert(c.current === "Hi", "pending 已排队");
    c.push("Goodbye", true);
    assert(c.current === "Goodbye", "倒退 → 同步跟上");
    const lenBefore = c.current.length;
    c.tick();
    assert(c.current.length === lenBefore, "倒退后 tick 是 no-op（pending 已清）");
  }

  console.log("=== destroy 清理 ===");
  {
    const c = new PacedValueController("");
    c.push("x".repeat(2000), true);
    c.destroy();
    let safety = 10;
    while (safety-- > 0) c.tick();
    assert(c.current === "", "destroy 后 tick 不释放（timer/pending 都已清）");
  }

  console.log("=== subscribe 触发 ===");
  {
    const c = new PacedValueController("a");
    let calls = 0;
    c.subscribe(() => calls++);
    c.push("abc", true);
    assert(calls === 1, "短 diff 同步释放触发 1 次通知");
    c.push("abcdefghi", true);
    c.tick();
    assert(calls === 2, "tick 触发 1 次通知");
  }
}

main();
if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
} else {
  console.log("\nall assertions passed");
}