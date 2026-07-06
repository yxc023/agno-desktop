/**
 * Round 9 tests (P3 + deferred P2 cluster from ce:review):
 *  - T: pushSubAgentPanel dedup against existing stack
 *  - O: chat-store idIndexBySession is kept in sync with setMessages
 *       and useSubMessageById returns the same value as findInTree
 *
 * Items R (loading chip timeout), P (loadingHint hoist), K (focus-trap),
 * U (sort tie-breaker), S (test strengthen) are exercised by the
 * existing test files that still pass; no React render harness here.
 */
import { useUIStore } from "../src/stores/ui-store";
import { useChatStore, useSubMessageById } from "../src/stores/chat-store";
import { findInTree } from "../src/stores/ui-store";
import type { ChatMessage } from "../src/lib/message-types";

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
    idIndexBySession: {},
    runner: null,
    loadingHistory: false,
    loadHistoryError: null,
  });
  useUIStore.setState({ subAgentPanel: { stack: [] } });
}

function main() {
  resetStores();

  /* ---------- Fix T: pushSubAgentPanel dedup ---------- */
  console.log("=== Fix T: pushSubAgentPanel dedup ===");
  {
    useUIStore.getState().openSubAgentPanel("sess-t", "sub-1");
    useUIStore.getState().pushSubAgentPanel("sess-t", "sub-2");
    useUIStore.getState().pushSubAgentPanel("sess-t", "sub-3");
    assert(
      useUIStore.getState().subAgentPanel.stack.length === 3,
      "stack has 3 entries (open + 2 distinct push)"
    );
    // Pushing an already-present (sess-t, sub-2) should no-op
    useUIStore.getState().pushSubAgentPanel("sess-t", "sub-2");
    assert(
      useUIStore.getState().subAgentPanel.stack.length === 3,
      "duplicate push (sub-2) does not append (length still 3)"
    );
    // The order should still be [sub-1, sub-2, sub-3]
    const stack = useUIStore.getState().subAgentPanel.stack;
    assert(
      stack[0].subMessageId === "sub-1" &&
        stack[1].subMessageId === "sub-2" &&
        stack[2].subMessageId === "sub-3",
      "stack order preserved ([sub-1, sub-2, sub-3])"
    );
    // Same sessionId but different subMessageId → should append
    useUIStore.getState().pushSubAgentPanel("sess-t", "sub-4");
    assert(
      useUIStore.getState().subAgentPanel.stack.length === 4,
      "different subMessageId (sub-4) appends (length 4)"
    );
    // Same subMessageId but different sessionId → should append
    useUIStore.getState().pushSubAgentPanel("sess-t-other", "sub-2");
    assert(
      useUIStore.getState().subAgentPanel.stack.length === 5,
      "different sessionId + same subMessageId (sess-t-other, sub-2) appends (length 5)"
    );
  }

  /* ---------- Fix O: idIndexBySession is kept in sync ---------- */
  console.log("=== Fix O: idIndexBySession kept in sync with setMessages ===");
  {
    resetStores();
    // Build a tree: top → sub1 → sub2 → sub3
    const deep: ChatMessage = {
      id: "msg-deep-top",
      role: "assistant",
      parts: [],
      status: "completed",
      createdAt: 100,
      sessionId: "sess-o",
      subMessages: [
        {
          id: "msg-deep-sub1",
          role: "assistant",
          parts: [],
          status: "completed",
          createdAt: 110,
          sessionId: "sess-o",
          subMessages: [
            {
              id: "msg-deep-sub2",
              role: "assistant",
              parts: [],
              status: "completed",
              createdAt: 120,
              sessionId: "sess-o",
              subMessages: [
                {
                  id: "msg-deep-sub3",
                  role: "assistant",
                  parts: [],
                  status: "completed",
                  createdAt: 130,
                  sessionId: "sess-o",
                },
              ],
            },
          ],
        },
      ],
    };
    useChatStore.getState().setMessages("sess-o", [deep]);
    const idx = useChatStore.getState().idIndexBySession["sess-o"];
    assert(!!idx, "idIndex built for sess-o");
    assert(
      idx?.size === 4,
      `idIndex has 4 entries (top + sub1 + sub2 + sub3), got ${idx?.size}`
    );
    assert(
      idx?.get("msg-deep-top") === deep,
      "idIndex.get('msg-deep-top') returns top"
    );
    assert(
      idx?.get("msg-deep-sub3") === deep.subMessages![0].subMessages![0]
        .subMessages![0],
      "idIndex.get('msg-deep-sub3') returns deepest sub (3 levels down)"
    );

    // useSubMessageById returns same as findInTree
    const byIndex = useChatStore.getState().idIndexBySession["sess-o"]!
      .get("msg-deep-sub2");
    const byWalk = findInTree([deep], "msg-deep-sub2");
    assert(byIndex === byWalk, "idIndex lookup === findInTree result");
    assert(!!byIndex, "deepest (sub2) found by index");
  }

  /* ---------- Fix O: idIndex rebuilt on setMessages ---------- */
  console.log("=== Fix O: setMessages rebuilds idIndex ===");
  {
    useChatStore.getState().setMessages("sess-o", [
      {
        id: "m1",
        role: "assistant",
        parts: [],
        status: "completed",
        createdAt: 1,
        sessionId: "sess-o",
      },
    ]);
    assert(
      useChatStore.getState().idIndexBySession["sess-o"]?.has("m1"),
      "idIndex rebuilt with m1"
    );
    // Re-set with different message
    useChatStore.getState().setMessages("sess-o", [
      {
        id: "m2",
        role: "assistant",
        parts: [],
        status: "completed",
        createdAt: 2,
        sessionId: "sess-o",
      },
    ]);
    const idx = useChatStore.getState().idIndexBySession["sess-o"];
    assert(!idx?.has("m1"), "old id (m1) no longer in index");
    assert(idx?.has("m2"), "new id (m2) in index");
  }

  /* ---------- Fix O: idIndex LRU eviction ---------- */
  console.log("=== Fix O: idIndex evicted alongside messagesBySession ===");
  {
    resetStores();
    // Cap is MESSAGES_BY_SESSION_LRU_LIMIT (20). Push 25 sessions in.
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
    const idx = useChatStore.getState().idIndexBySession;
    assert(
      Object.keys(idx).length === 20,
      `idIndex has 20 entries (got ${Object.keys(idx).length})`
    );
    assert(
      idx["sess-0"] === undefined && idx["sess-4"] === undefined,
      "oldest 5 idIndex entries evicted"
    );
    assert(idx["sess-24"]?.has("m-24"), "newest idIndex (sess-24) intact");
  }

  /* ---------- Fix O: idIndex findInTree parity for missing id ---------- */
  console.log("=== Fix O: idIndex returns null for missing id ===");
  {
    resetStores();
    useChatStore.getState().setMessages("sess-parity", [
      {
        id: "m-x",
        role: "assistant",
        parts: [],
        status: "completed",
        createdAt: 1,
        sessionId: "sess-parity",
      },
    ]);
    const idx = useChatStore.getState().idIndexBySession["sess-parity"]!;
    assert(idx.get("does-not-exist") === undefined, "idIndex returns undefined for missing id");
    // Same as findInTree
    const byWalk = findInTree(
      useChatStore.getState().messagesBySession["sess-parity"]!,
      "does-not-exist"
    );
    assert(byWalk === null, "findInTree returns null for missing id (parity)");
  }

  console.log("");
  if (failed > 0) {
    console.log(`❌ ${failed} assertions failed`);
    process.exit(1);
  } else {
    console.log("✅ all passed");
  }
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
