/**
 * Smoke test for ChatRunner sub-agent event routing.
 *
 * Simulates a team-mode SSE stream with:
 *   - Team's own content
 *   - 2 member agent sub-runs (parent_run_id != null)
 *
 * Verifies:
 *   - topMessage contains only team's content
 *   - subMessages contains 2 messages, each with its own content/tools
 *   - sub-message displayName/agentId is captured
 *
 * Usage:
 *   node node_modules/tsx/dist/cli.mjs scripts/test-subagent-routing.ts
 */
import { ChatRunner } from "../src/lib/chat-runner";
import type { AgRunResponse, AgToolCall } from "../src/lib/agno-types";
import type { ChatMessage } from "../src/lib/message-types";

interface CollectedCall {
  type: "update" | "subCreated" | "subFinalized";
  message: ChatMessage;
  parentId?: string;
}

const collected: CollectedCall[] = [];

const callbacks = {
  onMessageUpdate: (m: ChatMessage) => collected.push({ type: "update", message: m }),
  onSubMessageCreated: (parentId: string, sub: ChatMessage) =>
    collected.push({ type: "subCreated", parentId, message: sub }),
  onSubMessageFinalized: (parentId: string, sub: ChatMessage) =>
    collected.push({ type: "subFinalized", parentId, message: sub }),
  onRunStarted: () => {},
  onChunk: () => {},
};

// —— 假的 SSE 流：team mode 下产生的 events ——
async function* mockSSE() {
  const events: AgRunResponse[] = [
    // 1) team starts
    {
      event: "RunStarted",
      run_id: "team-1",
      parent_run_id: null,
      session_id: "sess-1",
      agent_id: "my-team",
      team_id: "my-team",
      status: "RUNNING",
    },
    // 2) team does some content
    {
      event: "RunContent",
      run_id: "team-1",
      parent_run_id: null,
      delta: "Let me delegate to web-search agent. ",
    },
    // 3) member1 starts
    {
      event: "RunStarted",
      run_id: "member-1",
      parent_run_id: "team-1",
      session_id: "sess-1",
      agent_id: "web-search",
      status: "RUNNING",
    },
    // 4) member1 reasoning
    {
      event: "ReasoningContent",
      run_id: "member-1",
      parent_run_id: "team-1",
      reasoning: "Searching for the latest AI news...",
    },
    // 5) member1 tool call
    {
      event: "ToolCallStarted",
      run_id: "member-1",
      parent_run_id: "team-1",
      tool: {
        tool_call_id: "tc-1",
        tool_name: "web_search",
        tool_args: { query: "latest AI news 2026" },
      } as AgToolCall,
    },
    {
      event: "ToolCallCompleted",
      run_id: "member-1",
      parent_run_id: "team-1",
      tool: {
        tool_call_id: "tc-1",
        tool_name: "web_search",
        tool_args: { query: "latest AI news 2026" },
        result: "[{\"title\": \"AI 2026 breakthrough\", \"url\": \"https://example.com\"}]",
      } as AgToolCall,
    },
    // 6) member1 content
    {
      event: "RunContent",
      run_id: "member-1",
      parent_run_id: "team-1",
      delta: "Found a recent AI breakthrough story.",
    },
    // 7) member1 done
    {
      event: "RunCompleted",
      run_id: "member-1",
      parent_run_id: "team-1",
      status: "COMPLETED",
      metrics: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    } as AgRunResponse,

    // 8) member2 starts
    {
      event: "RunStarted",
      run_id: "member-2",
      parent_run_id: "team-1",
      session_id: "sess-1",
      agent_id: "code-search",
      status: "RUNNING",
    },
    {
      event: "RunContent",
      run_id: "member-2",
      parent_run_id: "team-1",
      delta: "Let me also check the codebase context.",
    },
    {
      event: "RunCompleted",
      run_id: "member-2",
      parent_run_id: "team-1",
      status: "COMPLETED",
    } as AgRunResponse,

    // 9) team completes
    {
      event: "RunContent",
      run_id: "team-1",
      parent_run_id: null,
      delta: "Combining the results.",
    },
    {
      event: "RunCompleted",
      run_id: "team-1",
      parent_run_id: null,
      status: "COMPLETED",
      metrics: { input_tokens: 50, output_tokens: 30, total_tokens: 80 },
    } as AgRunResponse,
  ];

  for (const e of events) {
    yield {
      event: e.event,
      data: JSON.stringify(e),
    };
  }
}

const fakeClient = {
  runAgent: async function* () {
    yield* mockSSE();
  },
  continueAgentRun: async function* () {},
  resumeAgentRun: async function* () {},
} as any;

async function main() {
  const runner = new ChatRunner();
  await runner.run(
    {
      client: fakeClient,
      agentId: "my-team",
      message: "hi",
      sessionId: null,
    },
    callbacks
  );

  const all = runner.getAllMessages();
  const top = all.find((m) => !m.parentMessageId);
  const subs = all.filter((m) => m.parentMessageId);

  console.log("=== assertions ===");
  let failed = 0;

  function assert(cond: boolean, msg: string) {
    if (cond) {
      console.log(`✓ ${msg}`);
    } else {
      console.log(`✗ ${msg}`);
      failed++;
    }
  }

  assert(!!top, "top message exists");
  assert(subs.length === 2, `expected 2 sub-messages, got ${subs.length}`);

  if (top) {
    const text = top.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as any).text)
      .join("");
    assert(
      text === "Let me delegate to web-search agent. Combining the results.",
      `top text = ${JSON.stringify(text)}`
    );
    const toolCount = top.parts.filter((p) => p.type === "tool_call").length;
    assert(toolCount === 0, `top should have no tool calls, got ${toolCount}`);
  }

  const member1 = subs.find((s) => s.runId === "member-1");
  assert(!!member1, "member-1 exists");
  if (member1) {
    assert(member1.displayName === "web-search", `displayName=${member1.displayName}`);
    assert(member1.agentId === "web-search", `agentId=${member1.agentId}`);
    const reasoning = member1.parts
      .filter((p) => p.type === "reasoning")
      .map((p) => (p as any).text)
      .join("");
    assert(
      reasoning === "Searching for the latest AI news...",
      `member1 reasoning=${JSON.stringify(reasoning)}`
    );
    const toolCount = member1.parts.filter((p) => p.type === "tool_call").length;
    assert(toolCount === 1, `member1 tool count = ${toolCount}`);
    const tool = member1.parts.find(
      (p) => p.type === "tool_call"
    ) as any;
    assert(tool?.status === "completed", `member1 tool status=${tool?.status}`);
    assert(
      Array.isArray(tool?.result) ||
        typeof tool?.result === "string" ||
        typeof tool?.result === "object",
      `member1 tool result type=${
        typeof tool?.result
      }, value=${JSON.stringify(tool?.result)}`
    );
    const text = member1.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as any).text)
      .join("");
    assert(
      text === "Found a recent AI breakthrough story.",
      `member1 text=${JSON.stringify(text)}`
    );
  }

  const member2 = subs.find((s) => s.runId === "member-2");
  assert(!!member2, "member-2 exists");
  if (member2) {
    assert(member2.displayName === "code-search", `member2 displayName=${member2.displayName}`);
    const text = member2.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as any).text)
      .join("");
    assert(
      text === "Let me also check the codebase context.",
      `member2 text=${JSON.stringify(text)}`
    );
  }

  console.log(`\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
