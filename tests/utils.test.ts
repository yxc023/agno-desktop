/**
 * tests/utils.test.ts — pure helpers in src/lib/utils.ts
 *
 * 用一个文件覆盖 clampWidth / formatDate / formatRelativeTime / truncate
 * / safeJsonParse / generateId。后续纯函数也加这里。
 */
import { clampWidth, formatDate, formatRelativeTime, safeJsonParse, truncate } from "../src/lib/utils";

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

  console.log("\n=== clampWidth: NaN / undefined / null 兜底 ===");
  {
    assert(clampWidth(NaN, 50, 200) === 50, "NaN → min");
    assert(clampWidth(undefined as unknown as number, 50, 200) === 50, "undefined → min");
    assert(clampWidth(null as unknown as number, 50, 200) === 50, "null → min");
  }

  console.log("\n=== clampWidth: 四舍五入到整数 ===");
  {
    assert(clampWidth(99.4, 50, 200) === 99, "向下取整");
    assert(clampWidth(99.6, 50, 200) === 100, "四舍五入到整数");
    assert(clampWidth(100.5, 50, 200) === 101, "0.5 进位");
  }

  console.log("\n=== truncate ===");
  {
    assert(truncate("hello") === "hello", "短于 max 原样");
    assert(truncate("", 10) === "", "空串");
    assert(truncate("hello world", 5) === "hello…", "超长加省略号");
    assert(truncate(undefined as unknown as string, 5) === "", "undefined 兜底空串");
  }

  console.log("\n=== safeJsonParse ===");
  {
    const fb = { ok: false };
    assert(safeJsonParse<{ ok: boolean }>('{"ok":true}', fb).ok === true, "有效 JSON");
    assert(safeJsonParse<{ ok: boolean }>("not json", fb) === fb, "非法 JSON 返回 fallback");
    assert(safeJsonParse<{ ok: boolean }>(null, fb) === fb, "null 返回 fallback");
    assert(safeJsonParse<{ ok: boolean }>(undefined, fb) === fb, "undefined 返回 fallback");
  }

  console.log("\n=== formatDate / formatRelativeTime ===");
  {
    const d = formatDate(1700000000);
    assert(typeof d === "string" && d.length >= 8, `formatDate(unix-s) → ${d}`);
    const rel = formatRelativeTime(Date.now() / 1000 - 30);
    assert(rel === "刚刚", `formatRelativeTime(30s ago) = ${rel}`);
    const rel2 = formatRelativeTime(Date.now() / 1000 - 120);
    assert(rel2 === "2 分钟前", `formatRelativeTime(2min ago) = ${rel2}`);
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