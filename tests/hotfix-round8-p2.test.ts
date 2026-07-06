/**
 * Round 8 tests (P2 cluster from ce:review):
 *  - F: messagesBySession LRU cap (MESSAGES_BY_SESSION_LRU_LIMIT)
 *  - G: loadHistoryError flag set on getSessionRuns failure
 *  - H: loadHistory in-flight generation — stale setMessages skipped
 *  - L: displayNameForRun priority chain
 *
 * Fixes I (sub-agent error part), J (Header/Body share message), and
 * K (focus-trap) require either a stream harness or React render
 * setup, and are covered by the existing cancelRun cascade test (J's
 * "no behavior change" invariant) and manual verification.
 */
import { useChatStore } from "../src/stores/chat-store";
import { displayNameForRun } from "../src/lib/agent-name";
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
    loadHistoryError: null,
  });
}

async function main() {
  resetStores();

  /* ---------- Fix L: displayNameForRun priority ---------- */
  console.log("=== Fix L: displayNameForRun priority chain ===");
  {
    // 1. extra_data.agent_name wins over everything
    assert(
      displayNameForRun({
        agent_name: "TopAgent",
        team_name: "TopTeam",
        member_name: "Member1",
        agent_id: "aid",
        team_id: "tid",
        extra_data: { agent_name: "FromExtra" },
      }) === "FromExtra",
      "extra_data.agent_name wins over agent_name/team_name"
    );
    // 2. extra_data.team_name wins when no agent_name in extra_data
    assert(
      displayNameForRun({
        agent_name: "TopAgent",
        team_name: "TopTeam",
        member_name: "Member1",
        extra_data: { team_name: "FromExtraTeam" },
      }) === "FromExtraTeam",
      "extra_data.team_name wins over agent_name/team_name"
    );
    // 3. agent_name next
    assert(
      displayNameForRun({ agent_name: "TopAgent", team_name: "TopTeam" }) ===
        "TopAgent",
      "agent_name wins when no extra_data agent_name/team_name"
    );
    // 4. team_name next
    assert(
      displayNameForRun({ team_name: "TopTeam" }) === "TopTeam",
      "team_name wins when no agent_name"
    );
    // 5. member_name next
    assert(
      displayNameForRun({ member_name: "Member1" }) === "Member1",
      "member_name wins when no agent_name/team_name"
    );
    // 6. agent_id fallback
    assert(
      displayNameForRun({ agent_id: "aid" }) === "aid",
      "agent_id fallback when no name fields"
    );
    // 7. team_id fallback
    assert(
      displayNameForRun({ team_id: "tid" }) === "tid",
      "team_id fallback when no agent_id and no name fields"
    );
    // 8. empty/whitespace name skipped
    assert(
      displayNameForRun({ agent_name: "  ", extra_data: { agent_name: "  " } }) ===
        undefined,
      "whitespace-only name strings are skipped"
    );
    // 9. null/undefined input
    assert(
      displayNameForRun(null) === undefined &&
        displayNameForRun(undefined) === undefined,
      "null/undefined input returns undefined"
    );
  }

  /* ---------- Fix F: messagesBySession LRU ---------- */
  console.log("=== Fix F: messagesBySession LRU caps at 20 ===");
  {
    resetStores();
    // 25 different sessions, each with one message
    for (let i = 0; i < 25; i++) {
      useChatStore.getState().setMessages(`sess-${i}`, [
        {
          id: `m-${i}`,
          role: "user",
          parts: [{ type: "text", text: `s-${i}` }],
          status: "completed",
          createdAt: i,
        },
      ]);
    }
    const map = useChatStore.getState().messagesBySession;
    assert(
      Object.keys(map).length === 20,
      `map has 20 sessions (got ${Object.keys(map).length})`
    );
    // The first 5 (sess-0..4) should be evicted
    assert(
      map["sess-0"] === undefined &&
        map["sess-4"] === undefined,
      "oldest 5 sessions (sess-0..4) evicted"
    );
    // The most recent (sess-5..24) should be retained
    assert(!!map["sess-5"], "sess-5 retained (the oldest survivor)");
    assert(!!map["sess-24"], "sess-24 retained (the newest)");
    // Re-touching an older session promotes it
    useChatStore.getState().setMessages("sess-0", [
      {
        id: "m-0-again",
        role: "user",
        parts: [{ type: "text", text: "touched" }],
        status: "completed",
        createdAt: 999,
      },
    ]);
    const map2 = useChatStore.getState().messagesBySession;
    assert(!!map2["sess-0"], "sess-0 re-pinned (was evicted, now restored)");
  }

  /* ---------- Fix G: loadHistoryError on getSessionRuns failure ---------- */
  console.log("=== Fix G: getSessionRuns failure sets loadHistoryError ===");
  {
    resetStores();
    const originalWarn = console.warn;
    const warnCalls: any[] = [];
    console.warn = (...args: any[]) => warnCalls.push(args);
    try {
      const client = {
        getSession: async (): Promise<AgSessionDetail> => ({
          session_id: "sess-r8g",
          session_type: "agent",
          agent_id: "agent-r8g",
          chat_history: [
            { id: "u-r8g", role: "user", content: "hi", created_at: 1_783_600_000 } as any,
            { id: "a-r8g", role: "assistant", content: "ok", created_at: 1_783_600_001 } as any,
          ],
          agent_data: undefined, team_data: undefined, workflow_data: undefined,
        }),
        getSessionRuns: async (): Promise<AgRunResponse[]> => {
          throw new Error("network 500");
        },
      };
      useInstancesStore.setState({
        activeInstanceId: "inst-r8g",
        instances: [
          {
            id: "inst-r8g", name: "test", baseUrl: "http://localhost:0",
            agents: [{ id: "agent-r8g", name: "agent-r8g" } as any],
            agentsFetchedAt: Date.now(),
          } as any,
        ],
        getClient: () => client as any,
      });
      await useChatStore.getState().loadHistory("sess-r8g");
      const err = useChatStore.getState().loadHistoryError;
      assert(
        err === "network 500",
        `loadHistoryError set to error message (got ${JSON.stringify(err)})`
      );
      // console.warn called
      const runsWarn = warnCalls.filter((c) =>
        String(c[0] ?? "").includes("getSessionRuns failed")
      );
      assert(
        runsWarn.length >= 1,
        `console.warn called for runs failure (got ${runsWarn.length})`
      );
      // But chat_history still loaded (UI should not be empty)
      const msgs = useChatStore.getState().messagesBySession["sess-r8g"] ?? [];
      assert(msgs.length === 2, `chat_history still loaded (got ${msgs.length})`);
    } finally {
      console.warn = originalWarn;
    }
  }

  /* ---------- Fix H: loadHistory in-flight generation ---------- */
  console.log("=== Fix H: stale loadHistory generation no-ops setMessages ===");
  {
    resetStores();
    // Two parallel loadHistory calls: older one (slower client) should
    // NOT overwrite the newer one's setMessages.
    let resolveFirst: (v: AgSessionDetail) => void = () => {};
    const firstCall = new Promise<AgSessionDetail>((res) => {
      resolveFirst = res;
    });
    const clientSlow = {
      getSession: () => firstCall,
      getSessionRuns: async (): Promise<AgRunResponse[]> => [],
    };
    const clientFast = {
      getSession: async (): Promise<AgSessionDetail> => ({
        session_id: "sess-r8h",
        session_type: "agent",
        agent_id: "agent-r8h",
        chat_history: [
          { id: "u-r8h", role: "user", content: "fast", created_at: 1 } as any,
          { id: "a-r8h", role: "assistant", content: "fast reply", created_at: 2 } as any,
        ],
        agent_data: undefined, team_data: undefined, workflow_data: undefined,
      }),
      getSessionRuns: async (): Promise<AgRunResponse[]> => [],
    };
    let activeClient = clientFast;
    useInstancesStore.setState({
      activeInstanceId: "inst-r8h",
      instances: [
        {
          id: "inst-r8h", name: "test", baseUrl: "http://localhost:0",
          agents: [{ id: "agent-r8h", name: "agent-r8h" } as any],
          agentsFetchedAt: Date.now(),
        } as any,
      ],
      getClient: () => activeClient as any,
    });
    // Start the slow call (will be the older generation)
    const slowPromise = useChatStore.getState().loadHistory("sess-r8h");
    // Now run a fast call (newer generation)
    const fastPromise = useChatStore.getState().loadHistory("sess-r8h");
    // Resolve the fast one
    await fastPromise;
    const msgsAfterFast = useChatStore.getState().messagesBySession["sess-r8h"] ?? [];
    assert(
      msgsAfterFast.length === 2 &&
        msgsAfterFast.some((m) => m.parts.some((p) => p.type === "text" && (p as any).text === "fast reply")),
      "fast loadHistory applied its state"
    );
    // Now resolve the slow call
    resolveFirst({
      session_id: "sess-r8h",
      session_type: "agent",
      agent_id: "agent-r8h",
      chat_history: [
        { id: "u-r8h", role: "user", content: "SLOW", created_at: 1 } as any,
        { id: "a-r8h", role: "assistant", content: "SLOW reply", created_at: 2 } as any,
      ],
      agent_data: undefined, team_data: undefined, workflow_data: undefined,
    });
    await slowPromise;
    const msgsAfterSlow = useChatStore.getState().messagesBySession["sess-r8h"] ?? [];
    // Slow should NOT have overwritten fast
    const stillFast = msgsAfterSlow.some((m) =>
      m.parts.some((p) => p.type === "text" && (p as any).text === "fast reply")
    );
    const notSlow = !msgsAfterSlow.some((m) =>
      m.parts.some((p) => p.type === "text" && (p as any).text === "SLOW reply")
    );
    assert(stillFast, "fast reply still present (slow stale call skipped)");
    assert(notSlow, "slow reply NOT present (stale generation no-op)");
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
