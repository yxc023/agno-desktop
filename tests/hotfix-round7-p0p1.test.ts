/**
 * Round 7 tests (P0/P1 cluster from ce:review):
 *  - A: ReasoningStep events in sub-agent history → parts.steps populated
 *  - B: Sub-of-sub parent chain resolved from parent_run_id, not flattened
 *  - C: Empty assistant message emits a console.debug rather than silent drop
 *  - D: extractSubAgents no-op (events[] present but no agent_name) logs warning
 *
 * Fix E (markAllCancelled removed) is a pure deletion and is verified by
 * the existing cancelRun cascade test (hotfix-round5-fixes Fix #5)
 * continuing to pass.
 */
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
function resetStores() {
  useChatStore.setState({
    messagesBySession: {},
    runner: null,
    loadingHistory: false,
  });
}

async function main() {
  resetStores();

  /* ---------- Fix A: ReasoningStep in history ---------- */
  console.log("=== Fix A: ReasoningStep events populate parts.steps ===");
  {
    resetStores();
    const events = [
      { event: "RunStarted", run_id: "outer-r7a", agent_id: "code-search", agent_name: "CodeSearch", created_at: 1_783_500_000 },
      {
        event: "ToolCallStarted", run_id: "outer-r7a", agent_id: "code-search", agent_name: "CodeSearch",
        tool: { tool_call_id: "tc-r7a", tool_name: "query_my_codebase", tool_args: { question: "list files" } },
        created_at: 1_783_500_001,
      },
      { event: "RunStarted", run_id: "sub-r7a", agent_id: "x", agent_name: "X", parent_run_id: "outer-r7a", created_at: 1_783_500_002 },
      // Per-step reasoning events (the shape AGNO emits)
      {
        event: "ReasoningStep", run_id: "sub-r7a", agent_id: "x", agent_name: "X",
        reasoning_step: { title: "Plan", reasoning: "I'll list the dir" },
        parent_run_id: "outer-r7a", created_at: 1_783_500_003,
      },
      {
        event: "ReasoningStep", run_id: "sub-r7a", agent_id: "x", agent_name: "X",
        reasoning_step: { title: "Read", reasoning: "I see a.txt" },
        parent_run_id: "outer-r7a", created_at: 1_783_500_004,
      },
      {
        event: "ToolCallStarted", run_id: "sub-r7a", agent_id: "x", agent_name: "X",
        tool: { tool_call_id: "tc-sub-r7a", tool_name: "list_files" },
        parent_run_id: "outer-r7a", created_at: 1_783_500_005,
      },
      {
        event: "ToolCallCompleted", run_id: "sub-r7a", agent_id: "x", agent_name: "X",
        tool: { tool_call_id: "tc-sub-r7a", tool_name: "list_files", result: "ok", tool_call_error: false },
        parent_run_id: "outer-r7a", created_at: 1_783_500_006,
      },
      {
        event: "RunCompleted", run_id: "sub-r7a", agent_id: "x", agent_name: "X",
        content: "done", parent_run_id: "outer-r7a", created_at: 1_783_500_007,
      },
      {
        event: "ToolCallCompleted", run_id: "outer-r7a", agent_id: "code-search", agent_name: "CodeSearch",
        tool: { tool_call_id: "tc-r7a", tool_name: "query_my_codebase", result: "done", tool_call_error: false },
        created_at: 1_783_500_008,
      },
      { event: "RunCompleted", run_id: "outer-r7a", agent_id: "code-search", agent_name: "CodeSearch", content: "ok", created_at: 1_783_500_009 },
    ];
    const client = {
      getSession: async (): Promise<AgSessionDetail> => ({
        session_id: "sess-r7a",
        session_type: "agent",
        agent_id: "code-search",
        chat_history: [
          { id: "u-r7a", role: "user", content: "list files", created_at: 1_783_500_000 } as any,
          {
            id: "a-r7a", role: "assistant", content: "ok",
            tool_calls: [
              { id: "tc-r7a", type: "function", function: { name: "query_my_codebase", arguments: "{}" } },
            ],
            created_at: 1_783_500_009,
          } as any,
        ],
        agent_data: undefined, team_data: undefined, workflow_data: undefined,
      }),
      getSessionRuns: async (): Promise<AgRunResponse[]> => [
        { run_id: "outer-r7a", session_id: "sess-r7a", agent_id: "code-search", agent_name: "CodeSearch", status: "COMPLETED", events, parent_run_id: null } as any,
      ],
    };
    useInstancesStore.setState({
      activeInstanceId: "inst-r7a",
      instances: [
        {
          id: "inst-r7a", name: "test", baseUrl: "http://localhost:0",
          agents: [{ id: "code-search", name: "code-search" } as any],
          agentsFetchedAt: Date.now(),
        } as any,
      ],
      getClient: () => client as any,
    });
    await useChatStore.getState().loadHistory("sess-r7a");
    const msgs = useChatStore.getState().messagesBySession["sess-r7a"] ?? [];
    const asst = msgs.find((m) => m.role === "assistant");
    const subs = asst?.subMessages ?? [];
    assert(subs.length === 1, `1 sub attached (got ${subs.length})`);
    const sub = subs[0];
    const reasoningPart = sub?.parts.find((p) => p.type === "reasoning") as any;
    assert(!!reasoningPart, "sub has a reasoning part");
    assert(
      Array.isArray(reasoningPart?.steps) && reasoningPart.steps.length === 2,
      `reasoning.steps has 2 entries (got ${reasoningPart?.steps?.length})`
    );
    assert(
      reasoningPart?.steps?.[0]?.title === "Plan" &&
        reasoningPart?.steps?.[1]?.title === "Read",
      `steps preserve AGNO title order: [${reasoningPart?.steps?.map((s: any) => s.title).join(", ")}]`
    );
  }

  /* ---------- Fix B: Sub-of-sub parent chain ---------- */
  console.log("=== Fix B: sub-of-sub parent resolved from parent_run_id ===");
  {
    resetStores();
    // AGNO Team 模式：3-level tree
    //   root: run "team-r7b" (parent_run_id=null)
    //     sub: run "agent-r7b" (parent_run_id="team-r7b")
    //       sub-of-sub: run "tool-r7b" (parent_run_id="agent-r7b")
    const client = {
      getSession: async (): Promise<AgSessionDetail> => ({
        session_id: "sess-r7b",
        session_type: "team",
        team_id: "team-r7b",
        chat_history: [
          { id: "u-r7b", role: "user", content: "hi", created_at: 1_783_510_000 } as any,
          {
            id: "a-r7b", role: "assistant", content: "team reply",
            tool_calls: [
              { id: "tc-team-r7b", type: "function", function: { name: "delegate", arguments: "{}" } },
            ],
            created_at: 1_783_510_010,
          } as any,
        ],
        agent_data: undefined, team_data: undefined, workflow_data: undefined,
      }),
      getSessionRuns: async (): Promise<AgRunResponse[]> => [
        {
          run_id: "team-r7b", session_id: "sess-r7b", parent_run_id: null,
          team_id: "team-r7b", agent_id: "team-r7b", status: "COMPLETED",
          messages: [
            { id: "a-r7b", role: "assistant", content: "team reply",
              tool_calls: [{ id: "tc-team-r7b", type: "function", function: { name: "delegate", arguments: "{}" } }],
              created_at: 1_783_510_010,
            } as any,
          ],
          events: [],
        } as any,
        {
          run_id: "agent-r7b", session_id: "sess-r7b", parent_run_id: "team-r7b",
          agent_id: "agent-r7b", status: "COMPLETED",
          messages: [
            { id: "agent-msg-r7b", role: "assistant", content: "agent reply",
              tool_calls: [{ id: "tc-agent-r7b", type: "function", function: { name: "tool_call", arguments: "{}" } }],
              created_at: 1_783_510_005,
            } as any,
          ],
          events: [],
        } as any,
        {
          run_id: "tool-r7b", session_id: "sess-r7b", parent_run_id: "agent-r7b",
          agent_id: "tool-r7b", status: "COMPLETED",
          messages: [
            { id: "tool-msg-r7b", role: "assistant", content: "tool reply",
              created_at: 1_783_510_008,
            } as any,
          ],
          events: [],
        } as any,
      ],
    };
    useInstancesStore.setState({
      activeInstanceId: "inst-r7b",
      instances: [
        {
          id: "inst-r7b", name: "test", baseUrl: "http://localhost:0",
          agents: [{ id: "team-r7b", name: "team-r7b" } as any],
          agentsFetchedAt: Date.now(),
        } as any,
      ],
      getClient: () => client as any,
    });
    await useChatStore.getState().loadHistory("sess-r7b");
    const msgs = useChatStore.getState().messagesBySession["sess-r7b"] ?? [];
    const teamMsg = msgs.find((m) => m.id === "a-r7b");
    assert(!!teamMsg, "team message present");
    // Team should have agent-r7b as direct sub
    const teamSubs = teamMsg?.subMessages ?? [];
    const agentSub = teamSubs.find((s) => s.runId === "agent-r7b");
    assert(!!agentSub, "agent-r7b attached as direct sub of team");
    // agent-r7b should have tool-r7b as nested sub-of-sub (NOT a sibling of agent)
    const agentSubs = agentSub?.subMessages ?? [];
    const toolSub = agentSubs.find((s) => s.runId === "tool-r7b");
    assert(!!toolSub, "tool-r7b attached as sub-of-sub under agent-r7b (real parent)");
    // tool-r7b should NOT be a direct sub of team (the old broken behavior)
    const teamSubsWithoutAgent = teamSubs.filter((s) => s.runId !== "agent-r7b");
    const toolSiblingsOfAgent = teamSubsWithoutAgent.find((s) => s.runId === "tool-r7b");
    assert(
      !toolSiblingsOfAgent,
      "tool-r7b NOT a sibling of agent-r7b (was the old flatten bug)"
    );
  }

  /* ---------- Fix C: Empty assistant anchor → console.debug ---------- */
  console.log("=== Fix C: empty assistant emits console.debug instead of silent drop ===");
  {
    resetStores();
    const originalDebug = console.debug;
    const debugCalls: any[] = [];
    console.debug = (...args: any[]) => debugCalls.push(args);
    try {
      // Pass a run with an assistant message that has no content, no
      // reasoning_content, and no tool_calls — exactly the empty-anchor case.
      const client = {
        getSession: async (): Promise<AgSessionDetail> => ({
          session_id: "sess-r7c",
          session_type: "agent",
          agent_id: "agent-r7c",
          chat_history: [
            { id: "u-r7c", role: "user", content: "hi", created_at: 1_783_520_000 } as any,
            // Empty assistant — no content, no reasoning, no tool_calls
            { id: "a-r7c-empty", role: "assistant", content: "", created_at: 1_783_520_001 } as any,
            { id: "a-r7c-real", role: "assistant", content: "real reply", created_at: 1_783_520_002 } as any,
          ],
          agent_data: undefined, team_data: undefined, workflow_data: undefined,
        }),
        getSessionRuns: async (): Promise<AgRunResponse[]> => [
          { run_id: "agent-r7c", session_id: "sess-r7c", agent_id: "agent-r7c", status: "COMPLETED", events: [], messages: [] } as any,
        ],
      };
      useInstancesStore.setState({
        activeInstanceId: "inst-r7c",
        instances: [
          {
            id: "inst-r7c", name: "test", baseUrl: "http://localhost:0",
            agents: [{ id: "agent-r7c", name: "agent-r7c" } as any],
            agentsFetchedAt: Date.now(),
          } as any,
        ],
        getClient: () => client as any,
      });
      await useChatStore.getState().loadHistory("sess-r7c");
      // console.debug should have been called with our drop message
      const dropLogs = debugCalls.filter((c) =>
        String(c[0] ?? "").includes("dropping empty assistant")
      );
      assert(
        dropLogs.length >= 1,
        `console.debug called for empty assistant (got ${dropLogs.length})`
      );
      // The empty message is still dropped (don't change visible behavior)
      const msgs = useChatStore.getState().messagesBySession["sess-r7c"] ?? [];
      const emptyMsg = msgs.find((m) => m.id === "a-r7c-empty");
      assert(!emptyMsg, "empty assistant still dropped (behavior preserved)");
    } finally {
      console.debug = originalDebug;
    }
  }

  /* ---------- Fix D: extractSubAgents no-op warning ---------- */
  console.log("=== Fix D: events[] without agent_name logs warning ===");
  {
    resetStores();
    const originalWarn = console.warn;
    const warnCalls: any[] = [];
    console.warn = (...args: any[]) => warnCalls.push(args);
    try {
      // events[] with NO agent_name on any event
      const events = [
        { event: "RunStarted", run_id: "outer-r7d", created_at: 1_783_530_000 },
        { event: "ToolCallStarted", run_id: "outer-r7d", tool: { tool_call_id: "tc-r7d", tool_name: "noop" }, created_at: 1_783_530_001 },
        { event: "RunCompleted", run_id: "outer-r7d", content: "done", created_at: 1_783_530_002 },
      ];
      const client = {
        getSession: async (): Promise<AgSessionDetail> => ({
          session_id: "sess-r7d",
          session_type: "agent",
          agent_id: "agent-r7d",
          chat_history: [
            { id: "u-r7d", role: "user", content: "hi", created_at: 1_783_530_000 } as any,
            { id: "a-r7d", role: "assistant", content: "done", created_at: 1_783_530_002 } as any,
          ],
          agent_data: undefined, team_data: undefined, workflow_data: undefined,
        }),
        getSessionRuns: async (): Promise<AgRunResponse[]> => [
          // No agent_name on run either → outerAgentName is empty
          { run_id: "outer-r7d", session_id: "sess-r7d", agent_id: "agent-r7d", status: "COMPLETED", events } as any,
        ],
      };
      useInstancesStore.setState({
        activeInstanceId: "inst-r7d",
        instances: [
          {
            id: "inst-r7d", name: "test", baseUrl: "http://localhost:0",
            agents: [{ id: "agent-r7d", name: "agent-r7d" } as any],
            agentsFetchedAt: Date.now(),
          } as any,
        ],
        getClient: () => client as any,
      });
      await useChatStore.getState().loadHistory("sess-r7d");
      const noAgentNameLogs = warnCalls.filter((c) =>
        String(c[0] ?? "").includes("events[] present but no agent_name")
      );
      assert(
        noAgentNameLogs.length >= 1,
        `console.warn called for no-agent_name events[] (got ${noAgentNameLogs.length})`
      );
    } finally {
      console.warn = originalWarn;
    }
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
