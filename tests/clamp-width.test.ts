/**
 * clamp-width.test.ts — clampWidth 边界值 / NaN / undefined 处理
 */
/* oxlint-disable */

import { clampWidth } from "../src/lib/utils";

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.log(`✗ ${msg}`);
    failed++;
  }
}

function main(): void {
  console.log("=== clampWidth: 基本区间 ===");
  {
    assert(clampWidth(100, 50, 200) === 100, "中位值原样返回");
    assert(clampWidth(50, 50, 200) === 50, "恰好 min");
    assert(clampWidth(200, 50, 200) === 200, "恰好 max");
    assert(clampWidth(0, 50, 200) === 50, "低于 min → min");
    assert(clampWidth(999, 50, 200) === 200, "高于 max → max");
  }

  console.log("\n=== clampWidth: NaN / undefined / null ===");
  {
    assert(clampWidth(NaN, 50, 200) === 50, "NaN → min");
    assert(clampWidth(undefined as any, 50, 200) === 50, "undefined → min");
    assert(clampWidth(null as any, 50, 200) === 50, "null → min");
  }

  console.log("\n=== clampWidth: 四舍五入 ===");
  {
    assert(clampWidth(99.4, 50, 200) === 99, "向下取整");
    assert(clampWidth(99.6, 50, 200) === 100, "四舍五入到整数");
    assert(clampWidth(100.5, 50, 200) === 101, "0.5 进位");
  }

  console.log(
    `\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
