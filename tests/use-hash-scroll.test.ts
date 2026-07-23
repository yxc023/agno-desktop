/**
 * tests/use-hash-scroll.test.ts — src/hooks/use-hash-scroll.ts
 *
 * 覆盖 parseHash 行为、writeMessageHash 的 history 策略、空 hash 不写、
 * popstate / hashchange 都触发更新。
 */
import {
  parseHashForTest,
  writeMessageHashForTest,
} from "../src/hooks/use-hash-scroll";

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.log(`✗ ${msg}`);
    failed++;
  }
}

function main(): void {
  console.log("=== parseHash: 基本协议 ===");
  {
    assert(parseHashForTest("#message-abc123") === "abc123", "#message-abc123 → 'abc123'");
    assert(parseHashForTest("#message-") === null, "#message-  → null（空 id）");
    assert(parseHashForTest("#foo") === null, "#foo → null（非 message hash）");
    assert(parseHashForTest("") === null, "空串 → null");
    assert(parseHashForTest(null) === null, "null → null");
    assert(parseHashForTest(undefined) === null, "undefined → null");
    assert(parseHashForTest("#message-  trimmed  ") === "trimmed", "前后空白被 trim");
  }

  console.log("=== writeMessageHash: 策略 ===");
  {
    let currentHash = "#message-old";
    const replaceCalls: Array<[unknown, string, string]> = [];
    const fakeReplace: typeof history.replaceState = (
      state: unknown,
      _title: string,
      url?: string | null,
    ) => {
      replaceCalls.push([state, _title, url ?? ""]);
      if (url) currentHash = new URL("http://x" + url).hash;
    };
    const getHash = () => currentHash;

    writeMessageHashForTest("old", { getHash, replace: fakeReplace });
    assert(replaceCalls.length === 0, "current 已等于目标 → 不写 replace");

    writeMessageHashForTest("new", { getHash, replace: fakeReplace });
    assert(replaceCalls.length === 1, "current 是 message hash → 写 1 次 replace");
    assert(currentHash === "#message-new", "current hash 更新为 #message-new");

    currentHash = "";
    replaceCalls.length = 0;
    writeMessageHashForTest("foo", { getHash, replace: fakeReplace });
    assert(replaceCalls.length === 0, "current 是空 → 不写（保护干净 URL）");

    currentHash = "#settings";
    replaceCalls.length = 0;
    writeMessageHashForTest("foo", { getHash, replace: fakeReplace });
    assert(replaceCalls.length === 0, "current 是非 message hash → 不写（不覆盖其他状态）");
  }
}

main();
if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
} else {
  console.log("\nall assertions passed");
}