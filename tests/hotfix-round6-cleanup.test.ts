/**
 * Round 6 cleanup tests (safe_auto follow-ups to ce:review):
 *  - #21: buildSubFromEvents clamps durationMs to ≥0 when events arrive
 *         out-of-order.
 *  - #29: pushSubAgentPanel caps stack depth and ignores further pushes
 *         once at the cap (runaway click-loop guard).
 */
import { useUIStore } from "../src/stores/ui-store";
import { useChatStore } from "../src/stores/chat-store";
import type { AgRunResponse, AgSessionDetail } from "../src/lib/agno-types";
import { useInstancesStore } from "../src/stores/instances-store";

let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.log(`✗ ${msg}`);
    failed++;
  }
}

async function main() {
  /* ---------- Fix #29: pushSubAgentPanel cap ---------- */
  console.log("=== Fix #29: pushSubAgentPanel caps stack depth at 8 ===");
  {
    useUIStore.setState({ subAgentPanel: { stack: [] } });
    useUIStore.getState().openSubAgentPanel("sess-cap", "sub-root");
    assert(
      useUIStore.getState().subAgentPanel.stack.length === 1,
      "after openSubAgentPanel: stack length 1"
    );
    // Push up to the cap (8) — that's 7 more pushes after the root
    for (let i = 1; i <= 7; i++) {
      useUIStore.getState().pushSubAgentPanel("sess-cap", `sub-deep-${i}`);
    }
    assert(
      useUIStore.getState().subAgentPanel.stack.length === 8,
      `stack length 8 (was ${useUIStore.getState().subAgentPanel.stack.length})`
    );
    // Further pushes should no-op
    useUIStore.getState().pushSubAgentPanel("sess-cap", "sub-deep-extra");
    assert(
      useUIStore.getState().subAgentPanel.stack.length === 8,
      "after push beyond cap: stack still 8 (push no-op)"
    );
    // Pop restores the runaway
    useUIStore.getState().popSubAgentPanel();
    assert(
      useUIStore.getState().subAgentPanel.stack.length === 7,
      "after one pop: stack 7 (cap respected but stack mutable downward)"
    );
    // Reset
    useUIStore.getState().closeSubAgentPanel();
    assert(
      useUIStore.getState().subAgentPanel.stack.length === 0,
      "after closeSubAgentPanel: stack cleared"
    );
  }

  /* ---------- Fix #21: buildSubFromEvents clamps negative durationMs ---------- */
  console.log(
    "=== Fix #21: buildSubFromEvents clamps durationMs to ≥0 when last created_at < first"
  );
  {
    useChatStore.setState({
      messagesBySession: {},
      runner: null,
      loadingHistory: false,
    });
    // Events deliberately out of order: outer Started at created_at=1000s,
    // sub-agent's ToolCallStarted at created_at=500s (clock skew / batch
    // reordering). The outer agent_name ("Outer") lets the scope detector
    // correctly identify outer vs sub events.
    const events = [
      {
        event: "RunStarted",
        run_id: "outer-od",
        agent_id: "outer-agent",
        agent_name: "Outer",
        created_at: 1_000_000_000,
      },
      {
        event: "ToolCallStarted",
        run_id: "outer-od",
        agent_id: "outer-agent",
        agent_name: "Outer",
        created_at: 1_000_000_001,
        tool: { tool_call_id: "tc-outer-od", tool_name: "delegate_to_sub" },
      },
      {
        event: "RunStarted",
        run_id: "sub-od",
        agent_id: "x",
        agent_name: "X",
        created_at: 1_000_000_002,
        parent_run_id: "outer-od",
      },
      {
        event: "ToolCallStarted",
        run_id: "sub-od",
        agent_id: "x",
        agent_name: "X",
        created_at: 500_000_000, // earlier than outer Start — out of order
        parent_run_id: "outer-od",
        tool: { tool_call_id: "tc-od", tool_name: "noop" },
      },
      {
        event: "ToolCallCompleted",
        run_id: "sub-od",
        agent_id: "x",
        agent_name: "X",
        created_at: 1_000_000_005,
        parent_run_id: "outer-od",
        tool: { tool_call_id: "tc-od", tool_name: "noop", result: "ok", tool_call_error: false },
      },
      {
        event: "RunCompleted",
        run_id: "sub-od",
        agent_id: "x",
        agent_name: "X",
        created_at: 500_000_001,
        parent_run_id: "outer-od",
        content: "done",
      },
      {
        event: "ToolCallCompleted",
        run_id: "outer-od",
        agent_id: "outer-agent",
        agent_name: "Outer",
        created_at: 1_000_000_006,
        tool: { tool_call_id: "tc-outer-od", tool_name: "delegate_to_sub", result: "done", tool_call_error: false },
      },
      {
        event: "RunCompleted",
        run_id: "outer-od",
        agent_id: "outer-agent",
        agent_name: "Outer",
        created_at: 1_000_000_007,
        content: "outer reply",
      },
    ];
    const client = {
      getSession: async (): Promise<AgSessionDetail> => ({
        session_id: "sess-od",
        session_type: "agent",
        agent_id: "outer-od",
        chat_history: [
          { id: "u-od", role: "user", content: "hi", created_at: 1_000_000_000 } as any,
          {
            id: "a-od",
            role: "assistant",
            content: "outer reply",
            tool_calls: [
              { id: "tc-outer-od", type: "function", function: { name: "noop", arguments: "{}" } },
            ],
            created_at: 1_000_000_010,
          } as any,
        ],
        agent_data: undefined, team_data: undefined, workflow_data: undefined,
      }),
      getSessionRuns: async (): Promise<AgRunResponse[]> => [
        {
          run_id: "outer-od",
          session_id: "sess-od",
          agent_id: "outer-od",
          agent_name: "Outer", // matches the outer events' agent_name
          status: "COMPLETED",
          events,
          parent_run_id: null,
        } as any,
      ],
    };
    useInstancesStore.setState({
      activeInstanceId: "inst-od",
      instances: [
        {
          id: "inst-od", name: "test", baseUrl: "http://localhost:0",
          agents: [{ id: "outer-od", name: "outer-od" } as any],
          agentsFetchedAt: Date.now(),
        } as any,
      ],
      getClient: () => client as any,
    });
    await useChatStore.getState().loadHistory("sess-od");
    const msgs = useChatStore.getState().messagesBySession["sess-od"] ?? [];
    const asst = msgs.find((m) => m.role === "assistant");
    assert(!!asst, "assistant present after loadHistory");
    const subs = asst?.subMessages ?? [];
    assert(subs.length === 1, `1 sub (was ${subs.length})`);
    const sub = subs[0];
    const m = (sub?.metrics as any)?.duration;
    assert(
      m === undefined || (typeof m === "number" && m >= 0),
      `sub.metrics.duration is undefined or ≥0 (got ${m}); negative durations are clamped`
    );
  }

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
