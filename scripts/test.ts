#!/usr/bin/env bun
/**
 * 串行执行 tests/*.test.ts
 *
 * 为什么不用 `bun test tests/*.test.ts`：
 * - 这些测试是手写 assert 框架（文件底部 `main().catch(...).process.exit(...)`），
 *   不是 bun 的 describe/test。
 * - bun test 会并发 spawn 这些文件，第一个 process.exit() 会杀掉 bun 进程，
 *   其他文件根本来不及启动。
 * - 所以这里用 bun.spawnSync 串行跑每个文件，捕获退出码，
 *   全部跑完再统一汇总。
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const TEST_DIR = join(import.meta.dir, "..", "tests");

const files = readdirSync(TEST_DIR)
  .filter((f) => f.endsWith(".test.ts"))
  .sort();

if (files.length === 0) {
  console.error("no test files found in", TEST_DIR);
  process.exit(1);
}

let totalFailed = 0;
const results: { file: string; code: number; ms: number }[] = [];

for (const f of files) {
  const path = join(TEST_DIR, f);
  const t0 = Date.now();
  const r = spawnSync("bun", ["run", path], {
    stdio: "inherit",
    env: process.env,
  });
  const ms = Date.now() - t0;
  const code = r.status ?? 1;
  results.push({ file: f, code, ms });
  if (code !== 0) totalFailed++;
}

console.log("\n========================================");
console.log("Summary:");
for (const r of results) {
  const icon = r.code === 0 ? "✓" : "✗";
  console.log(`  ${icon} ${r.file}  (${r.ms}ms, exit=${r.code})`);
}
console.log("========================================");
const passed = results.length - totalFailed;
console.log(`${passed} passed, ${totalFailed} failed (${results.length} total)`);

process.exit(totalFailed === 0 ? 0 : 1);