/**
 * tests/chat-buffer.test.ts — src/lib/chat-buffer.ts
 *
 * 覆盖：
 *   - enqueue + flush：同 messageId 多次 enqueue 只 flush 最新那条
 *   - microtask 调度：只有 flush 完成后下一批 enqueue 才再次调度
 *   - shadow 捕获 + merge：
 *     - shadow 是 incoming 的前缀 → 用 shadow
 *     - shadow 不在 incoming 的前缀 → 用 incoming
 *     - 没有 shadow → 原样用 incoming
 *   - 清 shadow
 */

import {
  enqueueMessageUpdate,
  takePending,
  captureShadowFromMessage,
  mergeShadowIntoMessage,
  clearShadowForMessage,
  clearAllShadows,
  hasShadowFor,
  _resetBufferForTesting,
  setBufferFlushCallback,
} from "../src/lib/chat-buffer";
import type { ChatMessage } from "../src/lib/message-types";

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.log(`✗ ${msg}`);
    failed++;
  }
}

function textMsg(id: string, texts: string[]): ChatMessage {
  return {
    id,
    role: "assistant",
    parts: texts.map((t) => ({ type: "text", text: t }) as never),
    status: "streaming",
    createdAt: 0,
  };
}

function main(): void {
  console.log("=== enqueue + takePending: 同 messageId 合并 ===");
  {
    _resetBufferForTesting();
    const m1a = textMsg("m1", ["H"]);
    const m1b = textMsg("m1", ["Hel"]);
    const m1c = textMsg("m1", ["Hello"]);
    enqueueMessageUpdate("s1", m1a);
    enqueueMessageUpdate("s1", m1b);
    enqueueMessageUpdate("s1", m1c);
    const entries = takePending();
    assert(entries.length === 1, "同 messageId 多次 enqueue → 1 条 flush");
    assert(entries[0]!.message.parts[0]!.text === "Hello", "保留最新一条");
  }

  console.log("=== enqueue + takePending: 不同 messageId 不合并 ===");
  {
    _resetBufferForTesting();
    enqueueMessageUpdate("s1", textMsg("m1", ["a"]));
    enqueueMessageUpdate("s1", textMsg("m2", ["b"]));
    const entries = takePending();
    assert(entries.length === 2, "不同 messageId → 2 条 flush");
  }

  console.log("=== captureShadow + merge: shadow 是 incoming 的前缀 → 用 shadow ===");
  {
    _resetBufferForTesting();
    // SSE 推了 3 次累积：H / Hel / Hello
    captureShadowFromMessage(textMsg("m1", ["Hello"]));
    // HTTP refetch 拉到的 snapshot 只有 "Hel"
    const snap = textMsg("m1", ["Hel"]);
    const merged = mergeShadowIntoMessage(snap);
    assert(
      merged.parts[0]!.text === "Hello",
      "snapshot 比 shadow 旧 → 用 shadow 替换"
    );
  }

  console.log("=== merge: 没有 shadow → 原样用 incoming ===");
  {
    _resetBufferForTesting();
    const snap = textMsg("m1", ["Hello"]);
    const merged = mergeShadowIntoMessage(snap);
    assert(merged === snap, "无 shadow 时返回原对象（无新引用）");
  }

  console.log("=== merge: snapshot 是 shadow 的前缀（HTTP 拿到更新的）→ 用 incoming ===");
  {
    _resetBufferForTesting();
    captureShadowFromMessage(textMsg("m1", ["abc"]));
    const snap = textMsg("m1", ["abcdef"]);
    const merged = mergeShadowIntoMessage(snap);
    assert(
      merged.parts[0]!.text === "abcdef",
      "snapshot 比 shadow 新 → 用 incoming（不动）"
    );
  }

  console.log("=== merge: shadow 与 incoming 没有前缀关系 → 用 incoming（兜底） ===");
  {
    _resetBufferForTesting();
    captureShadowFromMessage(textMsg("m1", ["xxx"]));
    const snap = textMsg("m1", ["yyy"]);
    const merged = mergeShadowIntoMessage(snap);
    assert(
      merged.parts[0]!.text === "yyy",
      "shadow 不在 incoming 的前缀上 → 用 incoming（不动）"
    );
  }

  console.log("=== merge: 多 part 时按位置索引 ===");
  {
    _resetBufferForTesting();
    captureShadowFromMessage(
      textMsg("m1", ["thinking...", "\n\nfinal answer v2"])
    );
    const snap = textMsg("m1", ["thinking...", "\n\nfinal answer"]);
    const merged = mergeShadowIntoMessage(snap);
    assert(merged.parts[0]!.text === "thinking...", "part 0 没有变");
    assert(
      merged.parts[1]!.text === "\n\nfinal answer v2",
      "part 1 用 shadow 替换"
    );
  }

  console.log("=== clearShadowForMessage ===");
  {
    _resetBufferForTesting();
    captureShadowFromMessage(textMsg("m1", ["x"]));
    assert(hasShadowFor("m1"), "capture 后 hasShadowFor");
    clearShadowForMessage("m1");
    assert(!hasShadowFor("m1"), "clear 后 hasShadowFor = false");
  }

  console.log("=== clearAllShadows ===");
  {
    _resetBufferForTesting();
    captureShadowFromMessage(textMsg("m1", ["a"]));
    captureShadowFromMessage(textMsg("m2", ["b"]));
    clearAllShadows();
    assert(!hasShadowFor("m1") && !hasShadowFor("m2"), "clearAll 后清空");
  }

  console.log("=== flush 调度：enqueue 后立刻 takePending → flush 不会再被调度 ===");
  {
    _resetBufferForTesting();
    let flushCalls = 0;
    setBufferFlushCallback(() => {
      flushCalls++;
      takePending();
    });
    enqueueMessageUpdate("s1", textMsg("m1", ["a"]));
    // queueMicrotask 异步执行；flush 触发
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        assert(flushCalls === 1, "第一次 enqueue 触发 1 次 flush");
        enqueueMessageUpdate("s1", textMsg("m2", ["b"]));
        setTimeout(() => {
          assert(flushCalls === 2, "下一批 enqueue 再次 flush");
          _resetBufferForTesting();
          setBufferFlushCallback(() => {});
          resolve();
        }, 10);
      }, 10);
    });
  }
}

main().then(() => {
  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  } else {
    console.log("\nall assertions passed");
  }
});