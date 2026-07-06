/**
 * Test: extractSubAgents from runs[].events[]
 *
 * Verifies that we can reconstruct sub-agent ChatMessages purely from
 * AGNO's persisted streaming events, including:
 *   - Reasoning content
 *   - Tool calls with args and result
 *   - Final text from RunCompleted
 *   - Attribution to outer assistant message via tool_call_id
 */
import { useChatStore } from "../src/stores/chat-store";
import type { AgChatMessage, AgRunResponse, AgSessionDetail } from "../src/lib/agno-types";
import { useInstancesStore } from "../src/stores/instances-store";

// Build a `runs[0].events[]` that matches the real AGNO shape observed in
// the user's michael_agent / local-1783311230460 session.
function buildFakeEvents() {
  return [
    // idx 0
    { event: "RunStarted", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch", created_at: 1783300000 },
    { event: "ModelRequestStarted", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch", created_at: 1783300000 },
    { event: "ModelRequestCompleted", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch", created_at: 1783300000 },
    // outer ToolCallStarted (query_my_codebase)
    {
      event: "ToolCallStarted", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch",
      tool: {
        tool_call_id: "call_outer_1",
        tool_name: "query_my_codebase",
        tool_args: { question: "列出项目目录" },
      },
      created_at: 1783300001,
    },
    // sub-agent starts
    { event: "RunStarted", run_id: "sub-1", agent_id: "my-codebase", agent_name: "My Codebase", parent_run_id: "outer-1", created_at: 1783300002 },
    { event: "ModelRequestStarted", run_id: "sub-1", agent_id: "my-codebase", agent_name: "My Codebase", parent_run_id: "outer-1", created_at: 1783300002 },
    { event: "ModelRequestCompleted", run_id: "sub-1", agent_id: "my-codebase", agent_name: "My Codebase", parent_run_id: "outer-1", created_at: 1783300002 },
    // sub-agent ToolCallStarted (list_files)
    {
      event: "ToolCallStarted", run_id: "sub-1", agent_id: "my-codebase", agent_name: "My Codebase",
      tool: {
        tool_call_id: "call_sub_1a",
        tool_name: "list_files",
        tool_args: { directory: "/tmp", max_depth: 1 },
      },
      parent_run_id: "outer-1", created_at: 1783300003,
    },
    {
      event: "ToolCallCompleted", run_id: "sub-1", agent_id: "my-codebase", agent_name: "My Codebase",
      tool: {
        tool_call_id: "call_sub_1a",
        tool_name: "list_files",
        tool_args: { directory: "/tmp", max_depth: 1 },
        result: JSON.stringify({ directory: "/tmp", files: [{ path: "a.txt", type: "file" }] }),
        tool_call_error: false,
      },
      parent_run_id: "outer-1", created_at: 1783300004,
    },
    { event: "ModelRequestStarted", run_id: "sub-1", agent_id: "my-codebase", agent_name: "My Codebase", parent_run_id: "outer-1", created_at: 1783300005 },
    { event: "ModelRequestCompleted", run_id: "sub-1", agent_id: "my-codebase", agent_name: "My Codebase", parent_run_id: "outer-1", created_at: 1783300005 },
    {
      event: "RunCompleted",
      run_id: "sub-1", agent_id: "my-codebase", agent_name: "My Codebase",
      content: "我看到项目目录有 a.txt。", parent_run_id: "outer-1",
      created_at: 1783300006,
    },
    // outer ToolCallCompleted
    {
      event: "ToolCallCompleted", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch",
      tool: {
        tool_call_id: "call_outer_1",
        tool_name: "query_my_codebase",
        tool_args: { question: "列出项目目录" },
        result: "我看到项目目录有 a.txt。",
        tool_call_error: false,
      },
      created_at: 1783300007,
    },
    { event: "ModelRequestStarted", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch", created_at: 1783300008 },
    { event: "ModelRequestCompleted", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch", created_at: 1783300008 },
    {
      event: "RunContent", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch",
      content: "目录里有 a.txt。", created_at: 1783300009,
    },
    {
      event: "RunCompleted", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch",
      content: "目录里有 a.txt。", created_at: 1783300010,
    },
  ];
}

const fakeClient = {
  getSession: async (_id: string): Promise<AgSessionDetail> => {
    return {
      session_id: "sess-fake",
      session_type: "agent",
      agent_id: "code-search",
      chat_history: [
        {
          id: "user-msg-1", role: "user", content: "列出项目目录",
          created_at: 1783300000,
        } as AgChatMessage,
        {
          id: "assistant-msg-1", role: "assistant",
          content: "我来帮你查看。",
          tool_calls: [
            { id: "call_outer_1", type: "function", function: { name: "query_my_codebase", arguments: '{"question":"列出项目目录"}' } },
          ],
          created_at: 1783300001,
        } as AgChatMessage,
        {
          id: "tool-msg-1", role: "tool", content: "我看到项目目录有 a.txt。",
          tool_call_id: "call_outer_1", created_at: 1783300007,
        } as AgChatMessage,
        {
          id: "assistant-msg-2", role: "assistant",
          content: "目录里有 a.txt。", created_at: 1783300010,
        } as AgChatMessage,
      ],
      agent_data: undefined,
      team_data: undefined,
      workflow_data: undefined,
    };
  },
  getSessionRuns: async (_id: string): Promise<AgRunResponse[]> => {
    return [
      {
        run_id: "outer-1",
        session_id: "sess-fake",
        agent_id: "code-search",
        agent_name: "CodeSearch",
        status: "COMPLETED",
        events: buildFakeEvents(),
      } as any,
    ];
  },
};

useInstancesStore.setState({
  activeInstanceId: "inst-fake",
  instances: [
    {
      id: "inst-fake", name: "test", baseUrl: "http://localhost:0",
      agents: [{ id: "code-search", name: "CodeSearch" } as any],
      agentsFetchedAt: Date.now(),
    } as any,
  ],
  getClient: () => fakeClient as any,
});

async function main() {
  let failed = 0;
  function assert(cond: boolean, msg: string) {
    if (cond) console.log(`✓ ${msg}`);
    else { console.log(`✗ ${msg}`); failed++; }
  }

  await useChatStore.getState().loadHistory("sess-fake");
  const messages = useChatStore.getState().messagesBySession["sess-fake"] ?? [];

  console.log("=== assertions ===");

  // top-level messages: 2 consecutive assistants merge into one (within 10min gap),
  // so we expect user + merged-assistant = 2 messages.
  assert(messages.length === 2, `top count=${messages.length}, expected 2 (asst merged)`);

  const asst1 = messages.find((m) => m.id === "assistant-msg-1");
  assert(!!asst1, "assistant-msg-1 exists (carries merged content from asst2)");
  const user = messages.find((m) => m.id === "user-msg-1");
  assert(!!user, "user message exists");
  assert(messages.length === 2, "no leftover asst-msg-2 (merged into asst1)");

  if (asst1) {
    // Merged parts should contain both asst1's tool_call and asst2's text
    const parts = asst1.parts;
    const toolCount = parts.filter((p) => p.type === "tool_call").length;
    const textParts = parts.filter((p) => p.type === "text") as any[];
    const allText = textParts.map((p) => p.text).join("\n");
    assert(toolCount === 1, `merged asst1 tool count=${toolCount}, expected 1`);
    assert(
      allText.includes("我来帮你查看") && allText.includes("目录里有 a.txt"),
      `merged asst1 should carry text from both, got: ${JSON.stringify(allText)}`
    );

    const subs = asst1.subMessages ?? [];
    assert(subs.length === 1, `asst1 sub count=${subs.length}, expected 1 (My Codebase)`);
    if (subs.length === 1) {
      const sub = subs[0];
      assert(sub.runId === "sub-1", `sub.runId=${sub.runId}`);
      assert(sub.displayName === "My Codebase", `sub.displayName=${sub.displayName}`);
      assert(sub.agentId === "my-codebase", `sub.agentId=${sub.agentId}`);
      assert(sub.parentMessageId === asst1.id, "sub.parentMessageId matches");
      // parts: 1 tool_call + 1 text
      const subToolCount = sub.parts.filter((p) => p.type === "tool_call").length;
      const subText = sub.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as any).text)
        .join("");
      assert(subToolCount === 1, `sub tool count=${subToolCount}, expected 1`);
      assert(
        subText.includes("我看到项目目录有 a.txt"),
        `sub text contains '我看到项目目录有 a.txt', actual=${JSON.stringify(subText)}`
      );
      // tool result should be parsed JSON
      const tool = sub.parts.find((p) => p.type === "tool_call") as any;
      assert(tool?.status === "completed", `tool status=${tool?.status}`);
      assert(
        Array.isArray(tool?.result?.files) || typeof tool?.result === "object",
        `tool.result is object/array, actual type=${typeof tool?.result}`
      );
    }

    // Marker should be in parts
    const markerCount = asst1.parts.filter(
      (p) => p.type === "sub_message_marker"
    ).length;
    assert(markerCount === 1, `asst1 marker count=${markerCount}, expected 1`);
  }

  console.log(`\n${failed === 0 ? "✅ all passed" : `❌ ${failed} failed`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
