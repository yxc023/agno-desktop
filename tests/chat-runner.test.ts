/**
 * tests/chat-runner.test.ts
 *
 * 合并 runner-subagent-routing.test.ts + subagent-marker-injection.test.ts
 * ——都是 `new ChatRunner()` 路径，共享一套 assert / fakeClient 套路。
 *
 * 覆盖：
 *   1. SSE 路由：team 模式下 outer / member-1 / member-2 各自的 content /
 *      reasoning / tool_call / final text 正确归位
 *   2. marker 注入位置：sub 创建时 marker 紧跟 team 当前文本的尾部
 *   3. 多个 sub 顺序保留 + marker 引用对应 sub.id
 */
import { ChatRunner } from "../src/lib/chat-runner";
import type { AgRunResponse, AgToolCall } from "../src/lib/agno-types";
import type { ChatMessage } from "../src/lib/message-types";

// ─────────── assert framework ───────────
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.log(`✗ ${msg}`);
    failed++;
  }
}

function makeFakeClient(events: AgRunResponse[]) {
  return {
    runAgent: async function* () {
      for (const e of events) yield { event: e.event, data: JSON.stringify(e) };
    },
    continueAgentRun: async function* () {},
    resumeAgentRun: async function* () {},
  };
}

// ─────────── 1) SSE → sub-agent 路由 ───────────
async function testSubAgentRouting() {
  console.log("=== SSE → sub-agent routing: outer / member-1 / member-2 ===");
  const events: AgRunResponse[] = [
    { event: "RunStarted", run_id: "team-1", parent_run_id: null, session_id: "sess-1", agent_id: "my-team", team_id: "my-team", status: "RUNNING" },
    { event: "RunContent", run_id: "team-1", parent_run_id: null, delta: "Let me delegate to web-search agent. " },
    { event: "RunStarted", run_id: "member-1", parent_run_id: "team-1", session_id: "sess-1", agent_id: "web-search", status: "RUNNING" },
    { event: "ReasoningContent", run_id: "member-1", parent_run_id: "team-1", reasoning: "Searching for the latest AI news..." },
    { event: "ToolCallStarted", run_id: "member-1", parent_run_id: "team-1", tool: { tool_call_id: "tc-1", tool_name: "web_search", tool_args: { query: "latest AI news 2026" } } as AgToolCall },
    { event: "ToolCallCompleted", run_id: "member-1", parent_run_id: "team-1", tool: { tool_call_id: "tc-1", tool_name: "web_search", tool_args: { query: "latest AI news 2026" }, result: '[{"title": "AI 2026 breakthrough", "url": "https://example.com"}]' } as AgToolCall },
    { event: "RunContent", run_id: "member-1", parent_run_id: "team-1", delta: "Found a recent AI breakthrough story." },
    { event: "RunCompleted", run_id: "member-1", parent_run_id: "team-1", status: "COMPLETED", metrics: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } } as AgRunResponse,
    { event: "RunStarted", run_id: "member-2", parent_run_id: "team-1", session_id: "sess-1", agent_id: "code-search", status: "RUNNING" },
    { event: "RunContent", run_id: "member-2", parent_run_id: "team-1", delta: "Let me also check the codebase context." },
    { event: "RunCompleted", run_id: "member-2", parent_run_id: "team-1", status: "COMPLETED" } as AgRunResponse,
    { event: "RunContent", run_id: "team-1", parent_run_id: null, delta: "Combining the results." },
    { event: "RunCompleted", run_id: "team-1", parent_run_id: null, status: "COMPLETED", metrics: { input_tokens: 50, output_tokens: 30, total_tokens: 80 } } as AgRunResponse,
  ];

  const runner = new ChatRunner();
  await runner.run(
    { client: makeFakeClient(events) as never, agentId: "my-team", message: "hi", sessionId: null },
    {
      onMessageUpdate: () => {},
      onSubMessageCreated: () => {},
      onSubMessageFinalized: () => {},
      onRunStarted: () => {},
      onChunk: () => {},
    }
  );

  const all = runner.getAllMessages();
  const top = all.find((m) => !m.parentMessageId);
  const subs = all.filter((m) => m.parentMessageId);

  assert(!!top, "top message exists");
  eq(subs.length, 2, `2 sub-messages, got ${subs.length}`);
  if (!top) return;

  const topText = top.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
  eq(topText, "Let me delegate to web-search agent. Combining the results.", `top text`);
  eq(top.parts.filter((p) => p.type === "tool_call").length, 0, "top has no tool calls");

  const member1 = subs.find((s) => s.runId === "member-1");
  assert(!!member1, "member-1 exists");
  if (member1) {
    eq(member1.displayName, "web-search", "member1.displayName");
    eq(member1.agentId, "web-search", "member1.agentId");
    const reasoning = member1.parts.filter((p) => p.type === "reasoning").map((p) => (p as { text: string }).text).join("");
    eq(reasoning, "Searching for the latest AI news...", "member1 reasoning");
    eq(member1.parts.filter((p) => p.type === "tool_call").length, 1, "member1 tool count");
    const tool = member1.parts.find((p) => p.type === "tool_call") as { status?: string; result?: unknown };
    eq(tool?.status, "completed", "member1 tool status");
    assert(Array.isArray(tool?.result) && tool.result.length >= 1, "member1 tool.result non-empty array");
    {
      const arr = (tool?.result ?? []) as Array<{ title?: string; url?: string }>;
      assert(
        arr.length >= 1 && typeof arr[0].title === "string" && typeof arr[0].url === "string",
        "member1 tool.result[0] has title+url"
      );
    }
    const text = member1.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
    eq(text, "Found a recent AI breakthrough story.", "member1 text");
  }

  const member2 = subs.find((s) => s.runId === "member-2");
  assert(!!member2, "member-2 exists");
  if (member2) {
    eq(member2.displayName, "code-search", "member2.displayName");
    const text = member2.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
    eq(text, "Let me also check the codebase context.", "member2 text");
  }
}

// ─────────── 2) marker 注入位置（流式）───────────
async function testMarkerInjection() {
  console.log("=== marker injection during streaming ===");
  const events: AgRunResponse[] = [
    { event: "RunStarted", run_id: "t1", parent_run_id: null, agent_id: "team", status: "RUNNING" } as AgRunResponse,
    { event: "RunContent", run_id: "t1", parent_run_id: null, delta: "先查 web" } as AgRunResponse,
    { event: "RunStarted", run_id: "m1", parent_run_id: "t1", agent_id: "web-search", status: "RUNNING" } as AgRunResponse,
    { event: "RunContent", run_id: "m1", parent_run_id: "t1", delta: "web result" } as AgRunResponse,
    { event: "RunCompleted", run_id: "m1", parent_run_id: "t1", status: "COMPLETED" } as AgRunResponse,
    { event: "RunContent", run_id: "t1", parent_run_id: null, delta: "再查 code" } as AgRunResponse,
    { event: "RunStarted", run_id: "m2", parent_run_id: "t1", agent_id: "code-search", status: "RUNNING" } as AgRunResponse,
    { event: "RunContent", run_id: "m2", parent_run_id: "t1", delta: "code result" } as AgRunResponse,
    { event: "RunCompleted", run_id: "m2", parent_run_id: "t1", status: "COMPLETED" } as AgRunResponse,
    { event: "RunContent", run_id: "t1", parent_run_id: null, delta: "已查完" } as AgRunResponse,
    { event: "RunCompleted", run_id: "t1", parent_run_id: null, status: "COMPLETED" } as AgRunResponse,
  ];

  const runner = new ChatRunner();
  await runner.run(
    { client: makeFakeClient(events) as never, agentId: "team", message: "hi", sessionId: "sess-1" },
    { onMessageUpdate: () => {}, onChunk: () => {} }
  );

  const top = runner.getCurrentMessage() as ChatMessage;
  const subs = runner.getAllMessages().filter((m) => m.parentMessageId);
  assert(!!top, "top message exists");
  if (!top) return;

  const markers = top.parts.filter((p) => p.type === "sub_message_marker");
  eq(markers.length, 2, "2 markers");

  const label = (p: { type: string } & Record<string, unknown>): string => {
    if (p.type === "text") return `T("${(p.text as string).slice(0, 30)}")`;
    if (p.type === "sub_message_marker") return `M("${(p.subMessageId as string).slice(-6)}")`;
    return "?";
  };
  const order = top.parts.map((p, idx) => `[${idx}]${label(p as never)}`);
  eq(top.parts.length, 5, "5 parts total");
  assert(order[0].includes('T("先查 web")'), `idx 0 = team text`);
  assert(order[1].startsWith("[1]M"), `idx 1 = marker`);
  assert(order[2].includes('T("再查 code")'), `idx 2 = team text`);
  assert(order[3].startsWith("[3]M"), `idx 3 = marker`);
  assert(order[4].includes('T("已查完")'), `idx 4 = team text`);

  const m1 = subs.find((s) => s.runId === "m1")!;
  const m2 = subs.find((s) => s.runId === "m2")!;
  const m1Marker = markers.find((p: never) => (p as { subMessageId: string }).subMessageId === m1.id);
  const m2Marker = markers.find((p: never) => (p as { subMessageId: string }).subMessageId === m2.id);
  assert(!!m1Marker, "marker for m1 exists");
  assert(!!m2Marker, "marker for m2 exists");

  const idxM1 = top.parts.findIndex((p: never) => (p as { subMessageId?: string }).subMessageId === m1.id);
  const idxM2 = top.parts.findIndex((p: never) => (p as { subMessageId?: string }).subMessageId === m2.id);
  assert(idxM1 > 0 && idxM2 > idxM1, `markers in chronological order (m1<${idxM1}>, m2<${idxM2}>)`);

  const teamTexts = top.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text);
  eq(teamTexts.length, 3, "3 team text parts");
  eq(teamTexts[0], "先查 web", "first team text");
  eq(teamTexts[1], "再查 code", "second team text");
  eq(teamTexts[2], "已查完", "third team text");
}

// ─────────── helper ───────────
function eq<T>(actual: T, expected: T, msg: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

// ─────────── main ───────────
async function main(): Promise<void> {
  await testSubAgentRouting();
  await testMarkerInjection();
  console.log("");
  if (failed > 0) {
    console.log(`❌ ${failed} assertions failed`);
    process.exit(1);
  } else {
    console.log("✅ all passed");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});