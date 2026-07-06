/**
 * Tests for the 6 fixes from ce:review round 5:
 *   - Fix #1: replaceInTree forces new ref when updater returns same instance
 *   - Fix #3: attachedRunIds dedup uses bare subRunId (Stage A + Stage B co-fire)
 *   - Fix #4: duplicate ToolCallStarted events collapse to a single tool_call part
 *   - Fix #5: cancelRun cascade reaches sub-of-sub-of-sub (recursive walk)
 *
 * Fix #2 (topRunId first-event) and Fix #6 (panel session switch) are not
 * covered here — they require either private ChatRunner APIs or React render
 * of the panel; both verified manually.
 */
import { useChatStore } from "../src/stores/chat-store";
import { useSessionsStore } from "../src/stores/sessions-store";
import { useUIStore } from "../src/stores/ui-store";
import { ChatRunner } from "../src/lib/chat-runner";
import type {
  AgChatMessage,
  AgRunResponse,
  AgSessionDetail,
} from "../src/lib/agno-types";
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
  useUIStore.setState({ subAgentPanel: { stack: [] } });
}

async function main() {
  resetStores();

  /* ---------- Fix #1 ---------- */
  console.log("=== Fix #1: replaceInTree same-ref updater forces new ref ===");
  {
    useChatStore.getState().appendMessage("sess-f1", {
      id: "msg-f1",
      role: "assistant",
      parts: [{ type: "text", text: "hello" }],
      status: "streaming",
      createdAt: 1_000,
    });
    const before =
      useChatStore.getState().messagesBySession["sess-f1"]?.[0] ?? null;
    assert(before !== null, "seeded message");

    // Updater returns the SAME reference it was given. Old behaviour: store would
    // keep the old ref → selectors subscribed to this exact message (e.g.
    // SubAgentSidePanel) would skip the re-render. New behaviour: replaceInTree
    // shallow-clones when next === m.
    useChatStore
      .getState()
      .updateAnyMessage("sess-f1", "msg-f1", () => before!);
    const after =
      useChatStore.getState().messagesBySession["sess-f1"]?.[0] ?? null;
    assert(after !== null, "after update message still present");
    assert(after !== before, "after update: outer object reference changed");
    assert(
      after.id === before.id && after.parts === before.parts,
      "shallow clone: id and parts ref preserved"
    );
  }

  /* ---------- Fix #3 ---------- */
  console.log(
    "=== Fix #3: attachedRunIds dedup — same sub matched in events[] AND runs[].parent_run_id"
  );
  {
    resetStores();
    const events = [
      { event: "RunStarted", run_id: "outer-3", agent_id: "code-search", agent_name: "CodeSearch", created_at: 1783310000 },
      {
        event: "ToolCallStarted", run_id: "outer-3", agent_id: "code-search", agent_name: "CodeSearch",
        tool: { tool_call_id: "tc-3-outer", tool_name: "query_my_codebase", tool_args: { question: "hi" } },
        created_at: 1783310001,
      },
      { event: "RunStarted", run_id: "sub-3", agent_id: "my-codebase", agent_name: "My Codebase", parent_run_id: "outer-3", created_at: 1783310002 },
      {
        event: "RunCompleted",
        run_id: "sub-3", agent_id: "my-codebase", agent_name: "My Codebase",
        content: "Reply from sub.", parent_run_id: "outer-3",
        created_at: 1783310003,
      },
      {
        event: "ToolCallCompleted", run_id: "outer-3", agent_id: "code-search", agent_name: "CodeSearch",
        tool: { tool_call_id: "tc-3-outer", tool_name: "query_my_codebase", tool_args: { question: "hi" }, result: "Reply from sub.", tool_call_error: false },
        created_at: 1783310004,
      },
      { event: "RunCompleted", run_id: "outer-3", agent_id: "code-search", agent_name: "CodeSearch", content: "Outer reply.", created_at: 1783310005 },
    ];
    const client = {
      getSession: async (): Promise<AgSessionDetail> => ({
        session_id: "sess-f3",
        session_type: "team",
        team_id: "team-3",
        chat_history: [
          { id: "u-3", role: "user", content: "hi", created_at: 1783310000 } as AgChatMessage,
          {
            id: "a-3", role: "assistant", content: "Outer reply.",
            tool_calls: [
              { id: "tc-3-outer", type: "function", function: { name: "query_my_codebase", arguments: '{"question":"hi"}' } },
            ],
            created_at: 1783310005,
          } as AgChatMessage,
        ],
        agent_data: undefined, team_data: undefined, workflow_data: undefined,
      }),
      getSessionRuns: async (): Promise<AgRunResponse[]> => [
        // Outer run has events[] containing the sub agent (Stage A path)
        { run_id: "outer-3", session_id: "sess-f3", team_id: "team-3", agent_id: "code-search", agent_name: "CodeSearch", status: "COMPLETED", events, parent_run_id: null } as any,
        // Same sub-agent as a separate child run with parent_run_id set (Stage B path)
        { run_id: "sub-3", session_id: "sess-f3", parent_run_id: "outer-3", agent_id: "my-codebase", agent_name: "My Codebase", status: "COMPLETED", messages: [], events: [] } as any,
      ],
    };
    useInstancesStore.setState({
      activeInstanceId: "inst-f3",
      instances: [
        {
          id: "inst-f3", name: "test", baseUrl: "http://localhost:0",
          agents: [{ id: "team-3", name: "team-3" } as any],
          agentsFetchedAt: Date.now(),
        } as any,
      ],
      getClient: () => client as any,
    });
    await useChatStore.getState().loadHistory("sess-f3");
    const msgs = useChatStore.getState().messagesBySession["sess-f3"] ?? [];
    const asst = msgs.find((m) => m.role === "assistant");
    assert(!!asst, "assistant message present");
    const subs = asst?.subMessages ?? [];
    const subInstances = subs.filter((s) => s.runId === "sub-3");
    assert(
      subInstances.length === 1,
      `sub-3 attached ${subInstances.length} times (expected 1; was the dedup bug)`
    );
    // The marker for it should also appear once (one chip per sub)
    const markers = (asst?.parts ?? []).filter(
      (p) => p.type === "sub_message_marker" && (p as any).subMessageId === subInstances[0]?.id
    );
    assert(
      markers.length === 1,
      `marker for sub-3 appears ${markers.length} times (expected 1)`
    );
  }

  /* ---------- Fix #4 ---------- */
  console.log(
    "=== Fix #4: duplicate ToolCallStarted for same tool_call_id → single part, second updates it"
  );
  {
    resetStores();
    const events = [
      { event: "RunStarted", run_id: "outer-4", agent_id: "code-search", agent_name: "CodeSearch", created_at: 1783311000 },
      {
        event: "ToolCallStarted", run_id: "outer-4", agent_id: "code-search", agent_name: "CodeSearch",
        tool: { tool_call_id: "tc-4-outer", tool_name: "query_my_codebase", tool_args: { question: "v1" } },
        created_at: 1783311001,
      },
      { event: "RunStarted", run_id: "sub-4", agent_id: "my-codebase", agent_name: "My Codebase", parent_run_id: "outer-4", created_at: 1783311002 },
      // First Started for sub's list_files
      {
        event: "ToolCallStarted", run_id: "sub-4", agent_id: "my-codebase", agent_name: "My Codebase",
        tool: { tool_call_id: "call_4_dup", tool_name: "list_files", tool_args: { directory: "/tmp" } },
        parent_run_id: "outer-4", created_at: 1783311003,
      },
      // DUPLICATE Started for same tool_call_id (reconnect/replay scenario)
      {
        event: "ToolCallStarted", run_id: "sub-4", agent_id: "my-codebase", agent_name: "My Codebase",
        tool: { tool_call_id: "call_4_dup", tool_name: "list_files", tool_args: { directory: "/var", max_depth: 2 } },
        parent_run_id: "outer-4", created_at: 1783311004,
      },
      {
        event: "ToolCallCompleted", run_id: "sub-4", agent_id: "my-codebase", agent_name: "My Codebase",
        tool: {
          tool_call_id: "call_4_dup", tool_name: "list_files",
          tool_args: { directory: "/var", max_depth: 2 },
          result: JSON.stringify({ directory: "/var", files: [{ path: "b.txt" }] }),
          tool_call_error: false,
        },
        parent_run_id: "outer-4", created_at: 1783311005,
      },
      {
        event: "RunCompleted",
        run_id: "sub-4", agent_id: "my-codebase", agent_name: "My Codebase",
        content: "ok", parent_run_id: "outer-4",
        created_at: 1783311006,
      },
      {
        event: "ToolCallCompleted", run_id: "outer-4", agent_id: "code-search", agent_name: "CodeSearch",
        tool: { tool_call_id: "tc-4-outer", tool_name: "query_my_codebase", tool_args: { question: "v1" }, result: "ok", tool_call_error: false },
        created_at: 1783311007,
      },
      { event: "RunCompleted", run_id: "outer-4", agent_id: "code-search", agent_name: "CodeSearch", content: "Done.", created_at: 1783311008 },
    ];
    const client = {
      getSession: async (): Promise<AgSessionDetail> => ({
        session_id: "sess-f4",
        session_type: "agent",
        agent_id: "code-search",
        chat_history: [
          { id: "u-4", role: "user", content: "hi", created_at: 1783311000 } as AgChatMessage,
          {
            id: "a-4", role: "assistant", content: "Done.",
            tool_calls: [
              { id: "tc-4-outer", type: "function", function: { name: "query_my_codebase", arguments: '{"question":"v1"}' } },
            ],
            created_at: 1783311008,
          } as AgChatMessage,
        ],
        agent_data: undefined, team_data: undefined, workflow_data: undefined,
      }),
      getSessionRuns: async (): Promise<AgRunResponse[]> => [
        { run_id: "outer-4", session_id: "sess-f4", agent_id: "code-search", agent_name: "CodeSearch", status: "COMPLETED", events, parent_run_id: null } as any,
      ],
    };
    useInstancesStore.setState({
      activeInstanceId: "inst-f4",
      instances: [
        {
          id: "inst-f4", name: "test", baseUrl: "http://localhost:0",
          agents: [{ id: "code-search", name: "code-search" } as any],
          agentsFetchedAt: Date.now(),
        } as any,
      ],
      getClient: () => client as any,
    });
    await useChatStore.getState().loadHistory("sess-f4");
    const msgs = useChatStore.getState().messagesBySession["sess-f4"] ?? [];
    const asst = msgs.find((m) => m.role === "assistant");
    assert(!!asst, "assistant message present");
    const subs = asst?.subMessages ?? [];
    assert(subs.length === 1, `sub-4 attached ${subs.length} times (expected 1)`);
    const sub = subs[0];
    const toolParts = sub?.parts.filter((p) => p.type === "tool_call") ?? [];
    assert(
      toolParts.length === 1,
      `sub-4 has ${toolParts.length} tool_call parts (expected 1; was the duplicate-Started bug)`
    );
    // Verify the merged part picked up the latest args from the second Started
    assert(
      (toolParts[0] as any).args?.directory === "/var",
      `tool_call args directory=${(toolParts[0] as any).args?.directory} (expected "/var" — second Started wins)`
    );
    // Verify Completed was applied to the (single) part
    assert(
      toolParts[0]?.status === "completed",
      `tool_call status=${toolParts[0]?.status} (expected "completed")`
    );
  }

  /* ---------- Fix #5 ---------- */
  console.log(
    "=== Fix #5: cancelRun cascade reaches sub-of-sub-of-sub (recursive walk)"
  );
  {
    resetStores();
    // Build a 3-deep sub-of-sub tree, all streaming, via direct setMessages.
    const deep: any = {
      id: "msg-deep-top",
      role: "assistant",
      parts: [],
      status: "streaming",
      createdAt: 100,
      sessionId: "sess-f5",
      subMessages: [
        {
          id: "msg-deep-sub1",
          role: "assistant",
          parts: [],
          status: "streaming",
          createdAt: 110,
          sessionId: "sess-f5",
          subMessages: [
            {
              id: "msg-deep-sub2",
              role: "assistant",
              parts: [],
              status: "streaming",
              createdAt: 120,
              sessionId: "sess-f5",
              subMessages: [
                {
                  id: "msg-deep-sub3",
                  role: "assistant",
                  parts: [{ type: "tool_call", toolCallId: "tc-x", toolName: "fn", args: {}, status: "calling", startedAt: 130 }],
                  status: "streaming",
                  createdAt: 130,
                  sessionId: "sess-f5",
                },
              ],
            },
          ],
        },
      ],
    };
    useChatStore.getState().setMessages("sess-f5", [deep]);
    useSessionsStore.setState({ currentSessionId: "sess-f5" });
    // Stub a runner with just enough surface for cancelRun to skip the network call
    useChatStore.setState({
      runner: {
        abort: () => {},
        getCurrentRunId: () => "run-x",
        getCurrentMessage: () => null,
        getCurrentSessionId: () => "sess-f5",
      } as unknown as ChatRunner,
    });
    await useChatStore.getState().cancelRun();
    const list = useChatStore.getState().messagesBySession["sess-f5"] ?? [];
    function findById(lst: any[], id: string): any {
      for (const m of lst) {
        if (m.id === id) return m;
        if (m.subMessages?.length > 0) {
          const r = findById(m.subMessages, id);
          if (r) return r;
        }
      }
      return null;
    }
    const top = list[0];
    assert(top?.status === "cancelled", `top status=${top?.status} (expected cancelled)`);
    const sub1 = findById(list, "msg-deep-sub1");
    assert(sub1?.status === "cancelled", `sub1 status=${sub1?.status} (expected cancelled)`);
    const sub2 = findById(list, "msg-deep-sub2");
    assert(sub2?.status === "cancelled", `sub2 status=${sub2?.status} (expected cancelled; was the cascade bug)`);
    // sub3 was streaming → store-level cancelRun cancels it.
    // (The "paused vs cancelled" choice based on calling-tool state is
    // handled by ChatRunner.markAllCancelled, not by chat-store.cancelRun;
    // out of scope for this fix.)
    const sub3 = findById(list, "msg-deep-sub3");
    assert(
      sub3?.status === "cancelled",
      `sub3 status=${sub3?.status} (expected cancelled — was the cascade bug; reach is the fix)`
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

