/**
 * Tests for partitionParts — message.parts[] 的 partition 算法
 *
 * Two modes:
 *   - brief=false (default): 只对 read-like tool_call 做相邻合并（≥ 2 个）
 *   - brief=true: 任何相邻 tool_call 都合并；≥ 2 个才 group，单个仍 single
 *
 * hideReasoning 不在 partition 算法里 —— 是 MessageContent 渲染前的过滤。
 *
 * 用手写 assert + counter（项目约定），不用 bun:test。
 */

import { partitionParts } from "../src/lib/message-verbosity";
import type { MessagePart, ToolCallPart } from "../src/lib/message-types";

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed++;
    console.error(`✗ ${msg}`);
  } else {
    console.log(`✓ ${msg}`);
  }
}

const txt = (text: string): MessagePart => ({ type: "text", text });
const rsn = (text: string): MessagePart => ({ type: "reasoning", text });
const tool = (
  toolName: string,
  toolCallId: string,
  overrides: Partial<ToolCallPart> = {}
): ToolCallPart => ({
  type: "tool_call",
  toolCallId,
  toolName,
  args: {},
  status: "completed",
  startedAt: 0,
  ...overrides,
});

/* ---------------------------------------------------------------- */
/* non-brief mode (default behavior)                                  */
/* ---------------------------------------------------------------- */

console.log("non-brief mode:");
{
  // text only
  const parts = [txt("hello")];
  const out = partitionParts(parts, false);
  assert(out.length === 1 && out[0].kind === "single", "text only → single");
}
{
  // single read-like → single (≥ 2 required to group)
  const t = tool("read_file", "t1");
  const out = partitionParts([t], false);
  assert(out.length === 1 && out[0].kind === "single", "single read-like → single");
}
{
  // two consecutive read-like → group
  const a = tool("read_file", "a");
  const b = tool("read_file", "b");
  const out = partitionParts([a, b], false);
  assert(
    out.length === 1 && out[0].kind === "group",
    "two consecutive read-like → group"
  );
  if (out[0].kind === "group") {
    assert(out[0].tools.length === 2, "group has 2 tools");
  }
}
{
  // three consecutive read-like → single group of 3
  const a = tool("read_file", "a");
  const b = tool("read_file", "b");
  const c = tool("read_file", "c");
  const out = partitionParts([a, b, c], false);
  assert(
    out.length === 1 && out[0].kind === "group" && out[0].tools.length === 3,
    "three consecutive read-like → single group of 3"
  );
}
{
  // non-read-like (web_search) never groups in non-brief
  const a = tool("web_search", "a");
  const b = tool("web_search", "b");
  const out = partitionParts([a, b], false);
  assert(
    out.length === 2 && out[0].kind === "single" && out[1].kind === "single",
    "two non-read-like → 2 singles (non-brief doesn't group)"
  );
}
{
  // text between read-likes breaks the group
  const r1 = tool("read_file", "r1");
  const r2 = tool("read_file", "r2");
  const t1 = txt("between");
  const r3 = tool("read_file", "r3");
  const r4 = tool("read_file", "r4");
  const out = partitionParts([r1, r2, t1, r3, r4], false);
  assert(out.length === 3, "text between read-likes → 3 items");
  assert(out[0].kind === "group", "[r1,r2] group");
  assert(out[1].kind === "single", "[text] single");
  assert(out[2].kind === "group", "[r3,r4] group");
}
{
  // mixed read-like + non-read-like → only read-like pair groups
  const r1 = tool("read_file", "r1");
  const w1 = tool("web_search", "w1");
  const r2 = tool("read_file", "r2");
  const r3 = tool("read_file", "r3");
  const out = partitionParts([r1, w1, r2, r3], false);
  assert(out.length === 3, "mixed read+web_search → 3 items");
  assert(out[0].kind === "single", "[r1] single (no pair before)");
  assert(out[1].kind === "single", "[w1] single (non-read-like never joins)");
  assert(out[2].kind === "group", "[r2,r3] group");
}
{
  // reasoning parts pass through as single
  const out = partitionParts([rsn("thinking..."), txt("hi")], false);
  assert(out.length === 2, "reasoning + text → 2 items");
  assert(out[0].kind === "single" && out[1].kind === "single", "both single");
}

/* ---------------------------------------------------------------- */
/* brief mode                                                         */
/* ---------------------------------------------------------------- */

console.log("\nbrief mode:");
{
  // two consecutive any-type → group
  const a = tool("web_search", "a");
  const b = tool("web_search", "b");
  const out = partitionParts([a, b], true);
  assert(out.length === 1 && out[0].kind === "group", "two web_search → group (brief)");
}
{
  // mixed types in same group
  const a = tool("web_search", "a");
  const b = tool("shell", "b");
  const c = tool("read_file", "c");
  const out = partitionParts([a, b, c], true);
  assert(
    out.length === 1 && out[0].kind === "group" && out[0].tools.length === 3,
    "web_search + shell + read_file → single group of 3 (brief)"
  );
}
{
  // single tool stays single (≥ 2 required)
  const a = tool("web_search", "a");
  const out = partitionParts([a], true);
  assert(out.length === 1 && out[0].kind === "single", "single tool → single (brief)");
}
{
  // text breaks the group
  const a = tool("web_search", "a");
  const b = tool("web_search", "b");
  const t = txt("between");
  const c = tool("web_search", "c");
  const d = tool("web_search", "d");
  const out = partitionParts([a, b, t, c, d], true);
  assert(out.length === 3, "text breaks → 3 items (brief)");
  assert(out[0].kind === "group", "[a,b] group");
  assert(out[1].kind === "single", "[text] single");
  assert(out[2].kind === "group", "[c,d] group");
}
{
  // reasoning breaks the group
  const a = tool("shell", "a");
  const b = tool("shell", "b");
  const r = rsn("thinking...");
  const c = tool("shell", "c");
  const out = partitionParts([a, b, r, c], true);
  assert(out.length === 3, "reasoning breaks → 3 items (brief)");
  assert(out[0].kind === "group", "[a,b] group");
  assert(out[1].kind === "single", "[reasoning] single");
  assert(out[2].kind === "single", "[c] single (only 1 after reasoning)");
}
{
  // text-tool-text-tool-text-tool-text → 6 singles
  const t1 = txt("first");
  const a = tool("web_search", "a");
  const t2 = txt("second");
  const b = tool("web_search", "b");
  const t3 = txt("third");
  const c = tool("web_search", "c");
  const out = partitionParts([t1, a, t2, b, t3, c], true);
  assert(
    out.length === 6 && out.every((i) => i.kind === "single"),
    "alternating text/tool → 6 singles (brief)"
  );
}
{
  // text before and after a tool cluster
  const t1 = txt("intro");
  const a = tool("web_search", "a");
  const b = tool("web_search", "b");
  const t2 = txt("outro");
  const out = partitionParts([t1, a, b, t2], true);
  assert(out.length === 3, "text-tool cluster-text → 3 items (brief)");
  assert(out[0].kind === "single", "[intro] single");
  assert(out[1].kind === "group", "[a,b] group");
  assert(out[2].kind === "single", "[outro] single");
}
{
  // empty parts
  assert(partitionParts([], true).length === 0, "empty parts → empty result");
}
{
  // reasoning-only message
  const out = partitionParts([rsn("a"), rsn("b")], true);
  assert(
    out.length === 2 && out[0].kind === "single" && out[1].kind === "single",
    "reasoning-only → 2 singles"
  );
}

/* ---------------------------------------------------------------- */
/* algorithm invariants                                               */
/* ---------------------------------------------------------------- */

console.log("\ninvariants:");
{
  // order preservation across non-brief
  const r1 = tool("read_file", "r1");
  const r2 = tool("read_file", "r2");
  const r3 = tool("read_file", "r3");
  const t1 = txt("a");
  const r4 = tool("read_file", "r4");
  const r5 = tool("read_file", "r5");
  const out = partitionParts([r1, r2, r3, t1, r4, r5], false);
  const seen: string[] = [];
  for (const item of out) {
    if (item.kind === "group") {
      for (const t of item.tools) seen.push(t.toolCallId);
    } else if (item.part.type === "tool_call") {
      seen.push(item.part.toolCallId);
    }
  }
  assert(
    JSON.stringify(seen) === JSON.stringify(["r1", "r2", "r3", "r4", "r5"]),
    "scan order: tool calls appear in original order across groups"
  );
}
{
  // non-tool parts never get folded into tool groups (brief)
  const t = txt("x");
  const r = rsn("y");
  const ref: MessagePart = { type: "reference", references: [] };
  const out = partitionParts(
    [t, tool("read_file", "a"), r, ref],
    true
  );
  assert(
    out.length === 4 && out.every((i) => i.kind === "single"),
    "non-tool parts never fold into tool groups (brief)"
  );
}

console.log(`\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`);
process.exit(failed === 0 ? 0 : 1);