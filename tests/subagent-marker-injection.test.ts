/**
 * Tests for SubMessageMarker injection during streaming.
 *
 * Verifies:
 *   - When a new sub is created, a SubMessageMarker is pushed into topMessage.parts.
 *   - The marker references the sub by ID.
 *   - Markers appear at the position where the sub was spawned (interleaved with team content).
 *   - Multiple subs produce multiple markers in chronological order.
 */
import { ChatRunner } from "../src/lib/chat-runner";
import type { AgRunResponse, AgToolCall } from "../src/lib/agno-types";
import type { ChatMessage } from "../src/lib/message-types";

async function* mockTeamStream() {
  const events: AgRunResponse[] = [
    // team starts, emits text
    { event: "RunStarted", run_id: "t1", parent_run_id: null, agent_id: "team", status: "RUNNING" } as AgRunResponse,
    { event: "RunContent", run_id: "t1", parent_run_id: null, delta: "先查 web" } as AgRunResponse,
    // member1 starts
    { event: "RunStarted", run_id: "m1", parent_run_id: "t1", agent_id: "web-search", status: "RUNNING" } as AgRunResponse,
    { event: "RunContent", run_id: "m1", parent_run_id: "t1", delta: "web result" } as AgRunResponse,
    { event: "RunCompleted", run_id: "m1", parent_run_id: "t1", status: "COMPLETED" } as AgRunResponse,
    // team continues
    { event: "RunContent", run_id: "t1", parent_run_id: null, delta: "再查 code" } as AgRunResponse,
    // member2 starts
    { event: "RunStarted", run_id: "m2", parent_run_id: "t1", agent_id: "code-search", status: "RUNNING" } as AgRunResponse,
    { event: "RunContent", run_id: "m2", parent_run_id: "t1", delta: "code result" } as AgRunResponse,
    { event: "RunCompleted", run_id: "m2", parent_run_id: "t1", status: "COMPLETED" } as AgRunResponse,
    // team final content
    { event: "RunContent", run_id: "t1", parent_run_id: null, delta: "已查完" } as AgRunResponse,
    { event: "RunCompleted", run_id: "t1", parent_run_id: null, status: "COMPLETED" } as AgRunResponse,
  ];
  for (const e of events) yield { event: e.event, data: JSON.stringify(e) };
}

async function main() {
  let failed = 0;
  function assert(cond: boolean, msg: string) {
    if (cond) console.log(`✓ ${msg}`);
    else {
      console.log(`✗ ${msg}`);
      failed++;
    }
  }

  const runner = new ChatRunner();
  await runner.run(
    {
      client: {
        runAgent: async function* () {
          yield* mockTeamStream();
        },
        continueAgentRun: async function* () {},
        resumeAgentRun: async function* () {},
      } as any,
      agentId: "team",
      message: "hi",
      sessionId: "sess-1",
    },
    {
      onMessageUpdate: () => {},
      onChunk: () => {},
    }
  );

  const top = runner.getCurrentMessage()!;
  const subs = runner.getAllMessages().filter((m) => m.parentMessageId);

  console.log("=== markers in top.parts ===");
  const markers = top.parts.filter((p) => p.type === "sub_message_marker");
  assert(markers.length === 2, `expected 2 markers, got ${markers.length}`);

  // 验证 marker 顺序（用后缀区分两个不同的 sub id）
  const order = top.parts.map((p, idx) => {
    if (p.type === "text") return `[${idx}]T("${(p as any).text}")`;
    if (p.type === "sub_message_marker")
      return `[${idx}]M("${(p as any).subMessageId.slice(-6)}")`;
    return `[${idx}]?`;
  });
  console.log("  parts order:");
  for (const e of order) console.log("    " + e);
  assert(order.length === 5, `parts.length=${order.length}, expected 5`);
  assert(order[0].includes('T("先查 web")'), `idx 0 = team text "先查 web"`);
  assert(order[1].startsWith("[1]M"), `idx 1 = marker`);
  assert(order[2].includes('T("再查 code")'), `idx 2 = team text "再查 code"`);
  assert(order[3].startsWith("[3]M"), `idx 3 = marker`);
  assert(order[4].includes('T("已查完")'), `idx 4 = team text "已查完"`);

  // 校验 marker 指向 sub.id（sub 是由 runner 在 index 字典里的对象）
  const m1 = subs.find((s) => s.runId === "m1")!;
  const m2 = subs.find((s) => s.runId === "m2")!;
  const m1Marker = markers.find(
    (p: any) => p.subMessageId === m1.id
  );
  const m2Marker = markers.find(
    (p: any) => p.subMessageId === m2.id
  );
  assert(!!m1Marker, "marker for m1 exists");
  assert(!!m2Marker, "marker for m2 exists");

  // 校验位置：m1 的 marker 在 "先查 web" 之后，"再查 code" 之前
  const textParts = top.parts.filter((p) => p.type === "text") as any[];
  const idxOfM1 = top.parts.findIndex((p: any) => p.subMessageId === m1.id);
  const idxOfM2 = top.parts.findIndex((p: any) => p.subMessageId === m2.id);
  assert(idxOfM1 > 0 && idxOfM2 > idxOfM1, `marker order m1 then m2 (got ${idxOfM1}, ${idxOfM2})`);

  // 简单 sanity：team 内容（parts[m.text] = "先查 web" / "再查 code"）夹着 markers
  const teamTexts = textParts.map((p) => p.text);
  assert(teamTexts.length === 3, `team text parts = ${teamTexts.length}, expected 3`);
  assert(teamTexts[0] === "先查 web", `first team text = ${JSON.stringify(teamTexts[0])}`);
  assert(teamTexts[1] === "再查 code", `second team text = ${JSON.stringify(teamTexts[1])}`);
  assert(teamTexts[2] === "已查完", `third team text = ${JSON.stringify(teamTexts[2])}`);

  console.log(`\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} failed`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
