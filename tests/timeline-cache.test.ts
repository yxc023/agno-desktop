/**
 * tests/timeline-cache.test.ts — src/lib/timeline-cache.ts
 *
 * LRU 缓存的语义：超出 max 时淘汰最久未访问的 key。
 * Map 保留插入顺序，delete-then-set 把 key 推到队尾 →
 * "最久未访问" = 队首。
 */
import { TimelineCache } from "../src/lib/timeline-cache";

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.log(`✗ ${msg}`);
    failed++;
  }
}

function main(): void {
  console.log("=== 基本存取 ===");
  {
    const c = new TimelineCache<number>(3);
    assert(c.get("a") === undefined, "空 cache → get 返回 undefined");
    c.set("a", { measurements: [1, 2, 3] });
    assert(c.size === 1, "set 后 size = 1");
    assert(
      JSON.stringify(c.get("a")) === JSON.stringify({ measurements: [1, 2, 3] }),
      "get 取出原值"
    );
  }

  console.log("=== LRU 淘汰: 超 max 时淘汰最久未访问 ===");
  {
    const c = new TimelineCache<number>(3);
    c.set("a", { measurements: [1] });
    c.set("b", { measurements: [2] });
    c.set("c", { measurements: [3] });
    assert(c.size === 3, "size = 3 (满)");
    c.set("d", { measurements: [4] });
    assert(c.size === 3, "size 仍 = 3（淘汰了一个）");
    assert(c.get("a") === undefined, "a 被淘汰（最久未访问）");
    assert(c.get("b") !== undefined, "b 保留");
    assert(c.get("c") !== undefined, "c 保留");
    assert(c.get("d") !== undefined, "d 是新的");
  }

  console.log("=== LRU 语义: set 已有 key 视为\"访问\"，刷新位置 ===");
  {
    const c = new TimelineCache<number>(3);
    c.set("a", { measurements: [1] });
    c.set("b", { measurements: [2] });
    c.set("c", { measurements: [3] });
    // 重新 set a → a 应该被推到队尾
    c.set("a", { measurements: [10] });
    c.set("d", { measurements: [4] });
    assert(c.get("a") !== undefined, "a 因重新 set 保留");
    assert(c.get("b") === undefined, "b 被淘汰（现在最久未访问）");
  }

  console.log("=== delete / clear ===");
  {
    const c = new TimelineCache<number>(3);
    c.set("a", { measurements: [1] });
    c.set("b", { measurements: [2] });
    assert(c.delete("a") === true, "delete 存在的 key → true");
    assert(c.get("a") === undefined, "delete 后 get undefined");
    assert(c.delete("missing") === false, "delete 不存在的 key → false");
    assert(c.size === 1, "size = 1");
    c.clear();
    assert(c.size === 0, "clear 后 size = 0");
  }

  console.log("=== scrollOffset 字段 ===");
  {
    const c = new TimelineCache<number>(2);
    c.set("a", { measurements: [1], scrollOffset: 123 });
    const entry = c.get("a");
    assert(
      entry !== undefined && entry.scrollOffset === 123,
      "scrollOffset 字段正常存取"
    );
  }
}

main();
if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
} else {
  console.log("\nall assertions passed");
}