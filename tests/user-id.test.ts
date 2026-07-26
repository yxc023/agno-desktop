/**
 * tests/user-id.test.ts
 *
 * user-id 校验 / 解析 helper 的契约：
 *   - validateUserId: 拒空、过短、过长、非法字符；接受合法集合
 *   - hasUserId: trim 后非空
 *   - getInstanceUserId: 容忍 null / undefined / 空字符串 / 仅空白
 *
 * 这条规则的源头是 AGNO 服务端对 user_id 的宽松约束。把它集中到
 * src/lib/user-id.ts 之后，UI / store / form 都引用同一份，避免漂移。
 */
/* oxlint-disable */

import {
  validateUserId,
  hasUserId,
  getInstanceUserId,
  USER_ID_MIN,
  USER_ID_MAX,
} from "../src/lib/user-id";
import type { AgnoInstance } from "../src/stores/instances-store";

// ─────────── assert framework ───────────
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.log(`✗ ${msg}`);
    failed++;
  }
}

// ─────────── validateUserId ───────────

assert(validateUserId("") === "user_id 不能为空", "空串拒绝");
assert(validateUserId("   ") === "user_id 不能为空", "纯空白拒绝");
assert(validateUserId("a") !== null, `1 字符（< ${USER_ID_MIN}）拒绝`);
assert(validateUserId("a".repeat(USER_ID_MAX + 1)) !== null, `> ${USER_ID_MAX} 字符拒绝`);
assert(validateUserId("a b") !== null, "含空格拒绝");
assert(validateUserId("name/path") !== null, "含 / 拒绝");
assert(validateUserId("中文") !== null, "非 ASCII 拒绝（限定字母数字标点）");
assert(validateUserId(null as any) !== null, "null 拒绝");
assert(validateUserId(undefined as any) !== null, "undefined 拒绝");

assert(validateUserId("mike") === null, "短字母名通过");
assert(validateUserId("michael@team") === null, "含 @ 通过");
assert(validateUserId("mike.li") === null, "含 . 通过");
assert(validateUserId("mike-dev_42") === null, "字母数字+下划线连字符通过");
assert(validateUserId("a".repeat(USER_ID_MAX)) === null, `= ${USER_ID_MAX} 字符边界通过`);
assert(validateUserId("a".repeat(USER_ID_MIN)) === null, `= ${USER_ID_MIN} 字符边界通过`);
assert(validateUserId("  mike  ") === null, "trim 后合法通过（内部空白不入校验）");

// ─────────── hasUserId ───────────

assert(hasUserId("mike") === true, "非空 → true");
assert(hasUserId(" mike ") === true, "含空白非空 → true");
assert(hasUserId("") === false, "空串 → false");
assert(hasUserId("   ") === false, "纯空白 → false");
assert(hasUserId(null) === false, "null → false");
assert(hasUserId(undefined) === false, "undefined → false");

// ─────────── getInstanceUserId ───────────

const inst = (uid: string): AgnoInstance =>
  ({ id: "x", name: "n", baseUrl: "u", userId: uid }) as AgnoInstance;

assert(getInstanceUserId(inst("mike")) === "mike", "正常读取");
assert(getInstanceUserId(inst("  mike  ")) === "mike", "trim 后读取");
assert(getInstanceUserId(inst("")) === "", "空 userId → 空串");
assert(getInstanceUserId(null) === "", "null instance → 空串");
assert(getInstanceUserId(undefined) === "", "undefined instance → 空串");

// ─────────── summary ───────────

if (failed > 0) {
  console.log(`\n${failed} assertions failed`);
  process.exit(1);
} else {
  console.log("\n✓ all user-id assertions passed");
}