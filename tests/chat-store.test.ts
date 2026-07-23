/**
 * tests/chat-store.test.ts
 *
 * chat-store 是整个 chat 流程的中枢（messages / LRU / idIndex / panel / loading /
 * tool result index）。原 hotfix-round5..9 + per-session-loading-state +
 * loadhistory-tool-result-index + subagent-panel-stack 全部直接 store 断言合并到这里。
 *
 * loadHistory 路径上的 fixtures / 集成测试搬到 tests/loadhistory.test.ts（用真实
 * AGNO session 形状）。这个文件只覆盖纯 store 行为。
 */
import { useChatStore, buildToolResultIndex } from "../src/stores/chat-store";
import { useUIStore, findInTree } from "../src/stores/ui-store";
import { useInstancesStore } from "../src/stores/instances-store";
import { useSessionsStore } from "../src/stores/sessions-store";
import { ChatRunner } from "../src/lib/chat-runner";
import type { AgChatMessage, AgRunResponse, AgSessionDetail } from "../src/lib/agno-types";
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
function eq<T>(actual: T, expected: T, msg: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function resetStores() {
  useChatStore.setState({
    messagesBySession: {},
    idIndexBySession: {},
    loadingHistoryBySession: {},
    loadedHistoryBySession: {},
    loadingHistory: false,
    loadHistoryError: null,
    runner: null,
  });
  useUIStore.setState({ subAgentPanel: { stack: [] } });
  useInstancesStore.setState({
    instances: [],
    activeInstanceId: null,
    getClient: undefined as unknown as never,
  });
}

function findById(lst: ChatMessage[], id: string): ChatMessage | null {
  for (const m of lst) {
    if (m.id === id) return m;
    if (m.subMessages && m.subMessages.length > 0) {
      const r = findById(m.subMessages, id);
      if (r) return r;
    }
  }
  return null;
}

// ─────────── 1) replaceInTree: same-ref updater forces new outer ref ───────────
function testReplaceInTreeSameRef() {
  console.log("=== replaceInTree: same-ref updater forces new outer ref ===");
  resetStores();
  useChatStore.getState().appendMessage("sess-f1", {
    id: "msg-f1",
    role: "assistant",
    parts: [{ type: "text", text: "hello" }],
    status: "streaming",
    createdAt: 1_000,
  });
  const before = useChatStore.getState().messagesBySession["sess-f1"]?.[0];
  assert(!!before, "seeded message");

  useChatStore
    .getState()
    .updateAnyMessage("sess-f1", "msg-f1", () => before as ChatMessage);
  const after = useChatStore.getState().messagesBySession["sess-f1"]?.[0];
  assert(!!after, "after update message still present");
  assert(after !== before, "after update: outer object reference changed");
  assert(
    after?.id === before?.id && after?.parts === before?.parts,
    "shallow clone: id and parts ref preserved"
  );
}

// ─────────── 2) messagesBySession LRU (20 cap) ───────────
function testLRU() {
  console.log("=== messagesBySession LRU caps at 20 ===");
  resetStores();
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
  eq(
    Object.keys(map).length,
    20,
    `map has 20 sessions (got ${Object.keys(map).length})`
  );
  assert(!map["sess-0"] && !map["sess-4"], "oldest 5 sessions evicted");
  assert(!!map["sess-5"], "sess-5 retained");
  assert(!!map["sess-24"], "sess-24 retained");

  // Re-touch promotes
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
  assert(!!map2["sess-0"], "sess-0 re-pinned");
}

// ─────────── 3) idIndexBySession kept in sync ───────────
function testIdIndexSync() {
  console.log("=== idIndexBySession kept in sync with setMessages ===");
  resetStores();
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
  eq(idx?.size, 4, "idIndex has 4 entries (top + 3 sub)");
  assert(idx?.get("msg-deep-top") === deep, "idIndex.get top");
  assert(
    idx?.get("msg-deep-sub3") ===
      deep.subMessages![0].subMessages![0].subMessages![0],
    "idIndex.get deepest (3 levels down)"
  );

  // setMessages rebuilds index (old id gone, new id present)
  useChatStore.getState().setMessages("sess-o", [
    { id: "m1", role: "assistant", parts: [], status: "completed", createdAt: 1 },
  ]);
  const idx2 = useChatStore.getState().idIndexBySession["sess-o"];
  assert(!idx2?.has("m-deep-top"), "old top id gone");
  assert(idx2?.has("m1"), "new id m1 present");

  // idIndex LRU eviction mirrors messagesBySession
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
  const idxMap = useChatStore.getState().idIndexBySession;
  eq(Object.keys(idxMap).length, 20, "idIndex has 20 entries after eviction");
  assert(!idxMap["sess-0"] && !idxMap["sess-4"], "oldest 5 idIndex evicted");
  assert(idxMap["sess-24"]?.has("m-24"), "newest idIndex intact");

  // idIndex lookup === findInTree
  const byIndex = idxMap["sess-24"]!.get("m-24");
  const byWalk = findInTree(
    useChatStore.getState().messagesBySession["sess-24"]!,
    "m-24"
  );
  assert(byIndex === byWalk, "idIndex lookup === findInTree result");
  assert(
    idxMap["sess-24"]!.get("does-not-exist") === undefined,
    "idIndex returns undefined for missing id"
  );
  assert(
    findInTree(
      useChatStore.getState().messagesBySession["sess-24"]!,
      "does-not-exist"
    ) === null,
    "findInTree returns null for missing id"
  );
}

// ─────────── 4) pushSubAgentPanel cap (8) + dedup ───────────
function testPanelStack() {
  console.log("=== pushSubAgentPanel: cap 8 + dedup ===");
  resetStores();
  useUIStore.getState().openSubAgentPanel("sess-cap", "sub-root");
  eq(useUIStore.getState().subAgentPanel.stack.length, 1, "after open: 1");
  for (let i = 1; i <= 7; i++) {
    useUIStore.getState().pushSubAgentPanel("sess-cap", `sub-deep-${i}`);
  }
  eq(useUIStore.getState().subAgentPanel.stack.length, 8, "after 7 more pushes: 8");
  useUIStore.getState().pushSubAgentPanel("sess-cap", "sub-deep-extra");
  eq(useUIStore.getState().subAgentPanel.stack.length, 8, "push beyond cap: no-op");
  useUIStore.getState().popSubAgentPanel();
  eq(useUIStore.getState().subAgentPanel.stack.length, 7, "after pop: 7");

  // dedup
  useUIStore.getState().closeSubAgentPanel();
  useUIStore.getState().openSubAgentPanel("sess-t", "sub-1");
  useUIStore.getState().pushSubAgentPanel("sess-t", "sub-2");
  useUIStore.getState().pushSubAgentPanel("sess-t", "sub-3");
  eq(useUIStore.getState().subAgentPanel.stack.length, 3, "3 entries");
  useUIStore.getState().pushSubAgentPanel("sess-t", "sub-2");
  eq(useUIStore.getState().subAgentPanel.stack.length, 3, "duplicate push no-op");
  useUIStore.getState().pushSubAgentPanel("sess-t-other", "sub-2");
  eq(
    useUIStore.getState().subAgentPanel.stack.length,
    4,
    "different sessionId same subMessageId appends"
  );

  // close clears
  useUIStore.getState().closeSubAgentPanel();
  eq(useUIStore.getState().subAgentPanel.stack.length, 0, "close → empty");
}

// ─────────── 5) cancelRun cascade reaches deep sub tree ───────────
async function testCancelRunCascade() {
  console.log("=== cancelRun cascade reaches sub-of-sub-of-sub ===");
  resetStores();
  const deep: ChatMessage = {
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
                parts: [
                  {
                    type: "tool_call",
                    toolCallId: "tc-x",
                    toolName: "fn",
                    args: {},
                    status: "calling",
                    startedAt: 130,
                  },
                ],
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
  const top = list[0];
  eq(top?.status, "cancelled", "top status cancelled");
  eq(findById(list, "msg-deep-sub1")?.status, "cancelled", "sub1 cancelled");
  eq(
    findById(list, "msg-deep-sub2")?.status,
    "cancelled",
    "sub2 cancelled (was the cascade bug)"
  );
  eq(
    findById(list, "msg-deep-sub3")?.status,
    "cancelled",
    "sub3 cancelled (was the cascade bug)"
  );
}

// ─────────── 6) buildToolResultIndex ───────────
function testBuildToolResultIndex() {
  console.log("=== buildToolResultIndex: 三种 result 形态 + 鲁棒性 ===");
  {
    const runs: AgRunResponse[] = [
      {
        run_id: "r1",
        tools: [
          {
            tool_call_id: "tc-1",
            tool_name: "web_search",
            result: '{"search_id":"x","results":[{"url":"a","title":"A"}]}',
          },
          {
            tool_call_id: "tc-2",
            tool_name: "read_file",
            result: { content: "file content" },
          },
          { tool_call_id: "tc-3", tool_name: "list_files", result: null },
          { tool_call_id: "tc-4", tool_name: "no_result_field" },
        ],
      } as any,
    ];
    const idx = buildToolResultIndex(runs);
    eq(idx.size, 2, "只索引有 result 的两条");
    eq(
      idx.get("tc-1"),
      '{"search_id":"x","results":[{"url":"a","title":"A"}]}',
      "string result 原样"
    );
    eq(
      JSON.parse(idx.get("tc-2") ?? "{}"),
      { content: "file content" },
      "object result 序列化为 JSON"
    );
    assert(!idx.has("tc-3"), "null result 跳过");
    assert(!idx.has("tc-4"), "缺失 result 字段跳过");
  }

  console.log("\n=== buildToolResultIndex: 多 run 同 tool_call_id（last-wins）===");
  {
    const runs: AgRunResponse[] = [
      { run_id: "r1", tools: [{ tool_call_id: "tc-1", result: "first" }] } as any,
      { run_id: "r2", tools: [{ tool_call_id: "tc-1", result: "second" }] } as any,
    ];
    const idx = buildToolResultIndex(runs);
    eq(idx.get("tc-1"), "second", "后出现的 run 覆盖前者");
  }

  console.log("\n=== buildToolResultIndex: 鲁棒性 ===");
  {
    eq(buildToolResultIndex([]).size, 0, "空数组");
    eq(buildToolResultIndex(undefined as unknown as AgRunResponse[]).size, 0, "undefined");
    eq(
      buildToolResultIndex([{ run_id: "x" }] as unknown as AgRunResponse[]).size,
      0,
      "run 没 tools"
    );
    eq(
      buildToolResultIndex([{ run_id: "x", tools: "oops" }] as any[]).size,
      0,
      "tools 非数组"
    );
  }
}

// ─────────── 7) per-session loading flags ───────────
async function testPerSessionLoading() {
  console.log("=== per-session loading/loaded flags ===");
  resetStores();
  useInstancesStore.setState((s) => ({
    ...s,
    activeInstanceId: "fake-instance",
    instances: [
      {
        id: "fake-instance",
        name: "Fake",
        baseUrl: "http://fake",
        agents: [],
        agentsFetchedAt: 0,
        lastProbeAt: Date.now(),
      } as any,
    ],
    getClient: ((_id: string) => ({
      getSession: async (sid: string) => {
        await new Promise((r) => setTimeout(r, 60));
        return { session_id: sid, agent_id: "fake-agent", chat_history: [] };
      },
      getSessionRuns: async () => {
        await new Promise((r) => setTimeout(r, 60));
        return [];
      },
    })) as any,
  }));

  const sessionA = "session-A";
  const sessionB = "session-B";

  let s = useChatStore.getState();
  assert(s.loadingHistoryBySession[sessionA] === undefined, "loading[A] initially undefined");

  // fire-and-forget
  const pA = useChatStore.getState().loadHistory(sessionA);
  await new Promise((r) => setTimeout(r, 20));
  s = useChatStore.getState();
  assert(s.loadingHistoryBySession[sessionA] === true, "loading[A] flips to true mid-load");
  assert(s.loadedHistoryBySession[sessionA] !== true, "loaded[A] NOT yet true mid-load");
  await pA;
  s = useChatStore.getState();
  assert(s.loadingHistoryBySession[sessionA] === false, "loading[A] back to false");
  assert(s.loadedHistoryBySession[sessionA] === true, "loaded[A] true after complete");

  // setMessages clears loading + marks loaded
  useChatStore.setState((s) => ({
    loadingHistoryBySession: { ...s.loadingHistoryBySession, [sessionB]: true },
    loadedHistoryBySession: { ...s.loadedHistoryBySession, [sessionB]: false },
  }));
  useChatStore.getState().setMessages(sessionB, []);
  s = useChatStore.getState();
  assert(s.loadingHistoryBySession[sessionB] === false, "setMessages clears loading");
  assert(s.loadedHistoryBySession[sessionB] === true, "setMessages marks loaded");

  // clearMessages drops flags
  useChatStore.setState((s) => ({
    loadingHistoryBySession: { ...s.loadingHistoryBySession, [sessionA]: true },
    loadedHistoryBySession: { ...s.loadedHistoryBySession, [sessionA]: true },
  }));
  useChatStore.getState().clearMessages(sessionA);
  s = useChatStore.getState();
  assert(s.loadingHistoryBySession[sessionA] === undefined, "clearMessages drops loading");
  assert(s.loadedHistoryBySession[sessionA] === undefined, "clearMessages drops loaded");

  // LRU sync between loading flags and messagesBySession
  for (let i = 0; i < 30; i++) {
    const id = `lru-${i}`;
    useChatStore.setState((s) => ({
      loadingHistoryBySession: { ...s.loadingHistoryBySession, [id]: false },
      loadedHistoryBySession: { ...s.loadedHistoryBySession, [id]: true },
    }));
    useChatStore.getState().setMessages(id, []);
  }
  s = useChatStore.getState();
  assert(s.loadedHistoryBySession["lru-0"] === undefined, "LRU evict loaded flag");
  assert(s.loadedHistoryBySession["lru-29"] === true, "LRU keep newest loaded flag");
  assert(s.loadingHistoryBySession["lru-0"] === undefined, "LRU evict loading flag");
}

// ─────────── 8) loadHistoryError on getSessionRuns failure ───────────
async function testLoadHistoryError() {
  console.log("=== getSessionRuns failure → loadHistoryError ===");
  resetStores();
  const warnCalls: unknown[][] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => warnCalls.push(args);
  try {
    useInstancesStore.setState({
      activeInstanceId: "inst-r8g",
      instances: [
        {
          id: "inst-r8g",
          name: "test",
          baseUrl: "http://localhost:0",
          agents: [{ id: "agent-r8g", name: "agent-r8g" } as any],
          agentsFetchedAt: Date.now(),
        } as any,
      ],
      getClient: ((_id: string) => ({
        getSession: async (): Promise<AgSessionDetail> => ({
          session_id: "sess-r8g",
          session_type: "agent",
          agent_id: "agent-r8g",
          chat_history: [
            { id: "u-r8g", role: "user", content: "hi", created_at: 1 } as AgChatMessage,
            { id: "a-r8g", role: "assistant", content: "ok", created_at: 2 } as AgChatMessage,
          ],
          agent_data: undefined,
          team_data: undefined,
          workflow_data: undefined,
        }),
        getSessionRuns: async (): Promise<AgRunResponse[]> => {
          throw new Error("network 500");
        },
      })) as any,
    });
    await useChatStore.getState().loadHistory("sess-r8g");
    eq(
      useChatStore.getState().loadHistoryError,
      "network 500",
      "loadHistoryError set to error message"
    );
    const runsWarn = warnCalls.filter((c) =>
      String(c[0] ?? "").includes("getSessionRuns failed")
    );
    assert(runsWarn.length >= 1, "console.warn called for runs failure");
    eq(
      useChatStore.getState().messagesBySession["sess-r8g"]?.length,
      2,
      "chat_history still loaded despite runs failure"
    );
  } finally {
    console.warn = origWarn;
  }
}

// ─────────── 9) stale loadHistory generation no-op ───────────
async function testStaleLoadHistory() {
  console.log("=== stale loadHistory generation no-op ===");
  resetStores();
  let resolveFirst: (v: AgSessionDetail) => void = () => {};
  const firstCall = new Promise<AgSessionDetail>((res) => {
    resolveFirst = res;
  });
  let activeClient: { getSession: () => Promise<AgSessionDetail>; getSessionRuns: () => Promise<AgRunResponse[]> } =
    {
      getSession: () => firstCall,
      getSessionRuns: async () => [],
    };

  useInstancesStore.setState({
    activeInstanceId: "inst-r8h",
    instances: [
      {
        id: "inst-r8h",
        name: "test",
        baseUrl: "http://localhost:0",
        agents: [{ id: "agent-r8h", name: "agent-r8h" } as any],
        agentsFetchedAt: Date.now(),
      } as any,
    ],
    getClient: ((_id: string) => activeClient) as any,
  });

  const slowPromise = useChatStore.getState().loadHistory("sess-r8h");
  activeClient = {
    getSession: async (): Promise<AgSessionDetail> => ({
      session_id: "sess-r8h",
      session_type: "agent",
      agent_id: "agent-r8h",
      chat_history: [
        { id: "u-r8h", role: "user", content: "fast", created_at: 1 } as AgChatMessage,
        { id: "a-r8h", role: "assistant", content: "fast reply", created_at: 2 } as AgChatMessage,
      ],
      agent_data: undefined,
      team_data: undefined,
      workflow_data: undefined,
    }),
    getSessionRuns: async () => [],
  };
  const fastPromise = useChatStore.getState().loadHistory("sess-r8h");
  await fastPromise;
  const msgsAfterFast =
    useChatStore.getState().messagesBySession["sess-r8h"] ?? [];
  assert(
    msgsAfterFast.some((m) =>
      m.parts.some((p) => p.type === "text" && (p as { text: string }).text === "fast reply")
    ),
    "fast loadHistory applied"
  );

  resolveFirst({
    session_id: "sess-r8h",
    session_type: "agent",
    agent_id: "agent-r8h",
    chat_history: [
      { id: "u-r8h", role: "user", content: "SLOW", created_at: 1 } as AgChatMessage,
      { id: "a-r8h", role: "assistant", content: "SLOW reply", created_at: 2 } as AgChatMessage,
    ],
    agent_data: undefined,
    team_data: undefined,
    workflow_data: undefined,
  });
  await slowPromise;
  const msgsAfterSlow =
    useChatStore.getState().messagesBySession["sess-r8h"] ?? [];
  const stillFast = msgsAfterSlow.some((m) =>
    m.parts.some((p) => p.type === "text" && (p as { text: string }).text === "fast reply")
  );
  const notSlow = !msgsAfterSlow.some((m) =>
    m.parts.some((p) => p.type === "text" && (p as { text: string }).text === "SLOW reply")
  );
  assert(stillFast, "fast reply still present (slow stale call skipped)");
  assert(notSlow, "slow reply NOT present (stale generation no-op)");
}

// ─────────── main ───────────
async function main(): Promise<void> {
  testReplaceInTreeSameRef();
  testLRU();
  testIdIndexSync();
  testPanelStack();
  testBuildToolResultIndex();
  await testCancelRunCascade();
  await testPerSessionLoading();
  await testLoadHistoryError();
  await testStaleLoadHistory();
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