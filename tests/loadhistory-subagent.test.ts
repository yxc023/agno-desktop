/**
 * Smoke test for chat-store.loadHistory sub-message reconstruction.
 *
 * Builds a fake session detail + runs[] representing a team session:
 *   - chat_history: [user, team_assistant_with_combined_text]
 *   - runs:
 *       - team-1 (root): messages=[user_in, team_assistant]
 *       - member-1 (child of team-1): messages=[member1_assistant_with_tool_call]
 *       - member-2 (child of team-1): messages=[member2_assistant]
 *
 * Verifies:
 *   - top-level messages contain only user + team assistant
 *   - team_assistant has 2 subMessages, one per member
 *   - member sub messages contain tools/reasoning
 */
import { useChatStore } from "../src/stores/chat-store";
import type { AgChatMessage, AgRunResponse, AgSessionDetail } from "../src/lib/agno-types";

// Stub instances-store enough for the store to function
import { useInstancesStore } from "../src/stores/instances-store";

const fakeClient = {
  getSession: async (_id: string): Promise<AgSessionDetail> => {
    return {
      session_id: "sess-1",
      session_type: "team",
      team_id: "my-team",
      chat_history: [
        {
          id: "msg-user-1",
          role: "user",
          content: "What's the latest AI news?",
          created_at: 1_700_000_000,
        } as AgChatMessage,
        {
          id: "msg-team-1",
          role: "assistant",
          content:
            "Combining the results from web-search and code-search agents.",
          created_at: 1_700_000_001,
        } as AgChatMessage,
      ],
      agent_data: undefined,
      team_data: undefined,
      workflow_data: undefined,
    };
  },
  getSessionRuns: async (_id: string): Promise<AgRunResponse[]> => {
    return [
      // root: team
      {
        run_id: "team-1",
        parent_run_id: null,
        session_id: "sess-1",
        team_id: "my-team",
        agent_id: "my-team",
        status: "COMPLETED",
        messages: [
          {
            id: "msg-user-1",
            role: "user",
            content: "What's the latest AI news?",
            created_at: 1_700_000_000,
          } as AgChatMessage,
          {
            id: "msg-team-1",
            role: "assistant",
            content:
              "Combining the results from web-search and code-search agents.",
            created_at: 1_700_000_001,
          } as AgChatMessage,
        ],
      } as AgRunResponse,

      // child: web-search member
      {
        run_id: "member-1",
        parent_run_id: "team-1",
        session_id: "sess-1",
        agent_id: "web-search",
        status: "COMPLETED",
        extra_data: { agent_name: "WebSearchAgent" } as any,
        messages: [
          {
            id: "msg-member1-assistant",
            role: "assistant",
            content: "Latest AI news: AGNO 2.6 released with team support.",
            reasoning_content: "Searching for the latest AI news 2026...",
            reasoning_steps: [
              { title: "Search web", reasoning: "Use web_search tool" },
            ],
            tool_calls: [
              {
                tool_call_id: "tc-1",
                tool_name: "web_search",
                tool_args: { query: "latest AI news" },
                result: '[{"title":"AGNO 2.6", "url":"https://x.com/agno"}]',
              },
            ],
            created_at: 1_700_000_002,
          } as AgChatMessage,
        ],
      } as AgRunResponse,

      // child: code-search member
      {
        run_id: "member-2",
        parent_run_id: "team-1",
        session_id: "sess-1",
        agent_id: "code-search",
        status: "COMPLETED",
        extra_data: { agent_name: "CodeSearchAgent" } as any,
        messages: [
          {
            id: "msg-member2-assistant",
            role: "assistant",
            content: "Found 3 references in the codebase.",
            created_at: 1_700_000_003,
          } as AgChatMessage,
        ],
      } as AgRunResponse,
    ];
  },
};

let activeInstanceId = "inst-1";

void activeInstanceId;

// Hack: directly seed instances store state
useInstancesStore.setState({
  activeInstanceId: "inst-1",
  instances: [
    {
      id: "inst-1",
      name: "test",
      baseUrl: "http://localhost:0",
      agents: [{ id: "my-team", name: "my-team" } as any],
      agentsFetchedAt: Date.now(),
    } as any,
  ],
  getClient: () => fakeClient as any,
});

async function main() {
  await useChatStore.getState().loadHistory("sess-1");
  const messages = useChatStore.getState().messagesBySession["sess-1"] ?? [];
  let failed = 0;
  function assert(cond: boolean, msg: string) {
    if (cond) console.log(`✓ ${msg}`);
    else {
      console.log(`✗ ${msg}`);
      failed++;
    }
  }

  console.log("=== assertions ===");
  assert(messages.length === 2, `top-level count=${messages.length}, expected 2`);

  const user = messages.find((m) => m.role === "user");
  assert(!!user, "user message exists");

  const team = messages.find((m) => m.role === "assistant");
  assert(!!team, "team assistant message exists");
  if (team) {
    const subs = team.subMessages ?? [];
    assert(subs.length === 2, `team has ${subs.length} sub-messages, expected 2`);

    const sub1 = subs.find((s) => s.runId === "member-1");
    assert(!!sub1, "sub member-1 attached");
    if (sub1) {
      assert(
        sub1.displayName === "WebSearchAgent",
        `member1 displayName=${sub1.displayName}`
      );
      const text = sub1.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as any).text)
        .join("");
      assert(text.length > 0, `member1 has text: ${text}`);
      const toolCount = sub1.parts.filter((p) => p.type === "tool_call").length;
      assert(toolCount === 1, `member1 tool count=${toolCount}`);
      const hasReasoning = sub1.parts.some((p) => p.type === "reasoning");
      assert(hasReasoning, "member1 has reasoning part");
      assert(sub1.parentMessageId === team.id, "member1.parentMessageId is team.id");
    }

    const sub2 = subs.find((s) => s.runId === "member-2");
    assert(!!sub2, "sub member-2 attached");
    if (sub2) {
      assert(
        sub2.displayName === "CodeSearchAgent",
        `member2 displayName=${sub2.displayName}`
      );
      const hasTool = sub2.parts.some((p) => p.type === "tool_call");
      assert(!hasTool, "member2 has no tool calls (it's a code-search member)");
    }
  }

  console.log(`\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
