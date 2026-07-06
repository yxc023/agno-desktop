/**
 * Test: loadHistory timestamp-fallback matching for child runs.
 *
 * When AGNO doesn't populate chat_history.assistant.id == runs[].messages[].id
 * the stage-1 (runId) matching doesn't fire. The fallback uses chat_history
 * user timestamps to bracket child runs and attach them to the right assistant.
 */
import { useChatStore } from "../src/stores/chat-store";
import type { AgChatMessage, AgRunResponse, AgSessionDetail } from "../src/lib/agno-types";
import { useInstancesStore } from "../src/stores/instances-store";

/** chat_history 没有和 runs[].messages[].id 匹配的 id（reset 标识） */
const fakeClient = {
  getSession: async (_id: string): Promise<AgSessionDetail> => {
    return {
      session_id: "sess-X",
      session_type: "team",
      team_id: "teamX",
      chat_history: [
        {
          id: "unknown-user-id-1",
          role: "user",
          content: "question 1",
          // 100s
          created_at: 100,
        } as AgChatMessage,
        {
          id: "unknown-asst-id-1",
          role: "assistant",
          content: "team answer 1",
          // 110s (between user1=100 and user2=200)
          created_at: 110,
        } as AgChatMessage,
        {
          id: "unknown-user-id-2",
          role: "user",
          content: "question 2",
          created_at: 200,
        } as AgChatMessage,
        {
          id: "unknown-asst-id-2",
          role: "assistant",
          content: "team answer 2",
          created_at: 270,
        } as AgChatMessage,
      ],
      agent_data: undefined,
      team_data: undefined,
      workflow_data: undefined,
    };
  },
  getSessionRuns: async (_id: string): Promise<AgRunResponse[]> => {
    return [
      // root runs: ids 都不在 chat_history
      {
        run_id: "t-1",
        parent_run_id: null,
        session_id: "sess-X",
        team_id: "teamX",
        status: "COMPLETED",
        created_at: 105, // 在 user1=100 之后
        messages: [
          {
            id: "t-1-internal",
            role: "assistant",
            content: "team content 1",
          } as AgChatMessage,
        ],
      } as AgRunResponse,
      {
        run_id: "t-2",
        parent_run_id: null,
        session_id: "sess-X",
        team_id: "teamX",
        status: "COMPLETED",
        created_at: 220,
        messages: [
          {
            id: "t-2-internal",
            role: "assistant",
            content: "team content 2",
          } as AgChatMessage,
        ],
      } as AgRunResponse,

      // child run 1: 在 [100, 200) 之间，应挂在 asst-1 上
      {
        run_id: "m-1",
        parent_run_id: "t-1",
        session_id: "sess-X",
        agent_id: "web-search",
        status: "COMPLETED",
        created_at: 108, // 略晚于 user1
        messages: [
          {
            id: "m-1-msg",
            role: "assistant",
            content: "search result 1",
            tool_calls: [
              {
                tool_call_id: "tc-1",
                tool_name: "web_search",
                tool_args: { q: "x" },
                result: "ok",
              },
            ],
          } as AgChatMessage,
        ],
      } as AgRunResponse,

      // child run 2: 在 [200, ∞) 之间，应挂在 asst-2 上
      {
        run_id: "m-2",
        parent_run_id: "t-2",
        session_id: "sess-X",
        agent_id: "code-search",
        status: "COMPLETED",
        created_at: 250,
        messages: [
          {
            id: "m-2-msg",
            role: "assistant",
            content: "code result 2",
          } as AgChatMessage,
        ],
      } as AgRunResponse,

      // child run 3: 时间在 [100, 200) 之间，应该挂在 asst-1 上
      // （一个 assistant 可以挂多个 child run）
      {
        run_id: "m-3",
        parent_run_id: "t-1",
        session_id: "sess-X",
        agent_id: "another-agent",
        status: "COMPLETED",
        created_at: 115,
        messages: [
          {
            id: "m-3-msg",
            role: "assistant",
            content: "another result",
          } as AgChatMessage,
        ],
      } as AgRunResponse,
    ];
  },
};

useInstancesStore.setState({
  activeInstanceId: "inst-X",
  instances: [
    {
      id: "inst-X",
      name: "test",
      baseUrl: "http://localhost:0",
      agents: [{ id: "teamX", name: "teamX" } as any],
      agentsFetchedAt: Date.now(),
    } as any,
  ],
  getClient: () => fakeClient as any,
});

async function main() {
  let failed = 0;
  function assert(cond: boolean, msg: string) {
    if (cond) console.log(`✓ ${msg}`);
    else {
      console.log(`✗ ${msg}`);
      failed++;
    }
  }

  await useChatStore.getState().loadHistory("sess-X");
  const messages = useChatStore.getState().messagesBySession["sess-X"] ?? [];

  console.log("=== assertions ===");

  // 顶层 messages: 4 条 (user, asst, user, asst)
  assert(messages.length === 4, `top count=${messages.length}, expected 4`);

  const asst1 = messages.find((m) => m.id === "unknown-asst-id-1");
  const asst2 = messages.find((m) => m.id === "unknown-asst-id-2");

  assert(!!asst1, "asst1 exists");
  assert(!!asst2, "asst2 exists");

  // asst1 应该挂 2 个 sub（m-1 在 [100,200), m-3 也在 [100,200)）
  if (asst1) {
    const subs = asst1.subMessages ?? [];
    const m1 = subs.find((s) => s.runId === "m-1");
    const m3 = subs.find((s) => s.runId === "m-3");
    assert(subs.length === 2, `asst1 subs count=${subs.length}, expected 2`);
    assert(!!m1, "m-1 attached to asst1");
    assert(!!m3, "m-3 attached to asst1");
    if (m1) {
      assert(m1.displayName === "web-search", `m-1 displayName=${m1.displayName}`);
      const hasTool = m1.parts.some((p) => p.type === "tool_call");
      assert(hasTool, "m-1 has tool_call part");
    }
  }

  // asst2 应该挂 1 个 sub（m-2 在 [200,∞)）
  if (asst2) {
    const subs = asst2.subMessages ?? [];
    const m2 = subs.find((s) => s.runId === "m-2");
    assert(subs.length === 1, `asst2 subs count=${subs.length}, expected 1`);
    assert(!!m2, "m-2 attached to asst2");
  }

  // asst1.parts 应包含 2 个 marker（m-1 + m-3），按 createdAt 排序
  if (asst1) {
    const markers = asst1.parts.filter(
      (p) => p.type === "sub_message_marker"
    ) as any[];
    assert(markers.length === 2, `asst1 markers=${markers.length}, expected 2`);
    // find m-1 marker and m-3 marker
    const m1Marker = markers.find((p) => {
      const sub = asst1.subMessages?.find((s) => s.id === p.subMessageId);
      return sub?.runId === "m-1";
    });
    const m3Marker = markers.find((p) => {
      const sub = asst1.subMessages?.find((s) => s.id === p.subMessageId);
      return sub?.runId === "m-3";
    });
    assert(!!m1Marker, "asst1 has marker for m-1");
    assert(!!m3Marker, "asst1 has marker for m-3");
  }

  console.log(`\n${failed === 0 ? "✅ all passed" : `❌ ${failed} failed`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
