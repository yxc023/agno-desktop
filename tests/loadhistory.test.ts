/**
 * tests/loadhistory.test.ts
 *
 * 把 5 个 loadhistory-*.test.ts + 相关 hotfix-round5..7 里的 fixture-bearing
 * scenarios 合并。共享同一份"主 fixture"——一个真实的 AGNO team session：
 *   user → outer (CodeSearch) → member1 (MyCodebase, web_search) →
 *                               member2 (AnotherAgent, list_files)
 * 每个 scenario 在这个 fixture 上叠加事件来验证不同维度。
 *
 * 覆盖：
 *   1. events[] 抽取 sub-agent（reasoning / tool / final text / RunContent）
 *   2. team mode（runs[].messages[]）下重建 sub-message
 *   3. 时间戳 fallback（chat_history 没有 run-id 匹配时按 createdAt 分桶）
 *   4. marker 位置（紧跟在触发的 tool_call 之后）
 *   5. attachedRunIds 去重（同一 sub 在 events[] AND runs[].parent_run_id）
 *   6. ToolCallStarted dedup（replay 场景合并 args / 二次 Started wins）
 *   7. ReasoningStep → parts.steps
 *   8. sub-of-sub 父子链（按 parent_run_id 递归挂载，不扁平化）
 *   9. 空 assistant 消息（debug log + 仍 drop）
 *  10. events[] 缺 agent_name → warn
 *  11. buildSubFromEvents 把负 durationMs clamp 到 ≥0
 */
import { useChatStore } from "../src/stores/chat-store";
import { useInstancesStore } from "../src/stores/instances-store";
import type {
  AgChatMessage,
  AgRunResponse,
  AgSessionDetail,
} from "../src/lib/agno-types";

// ─────────── assert framework ───────────
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.log(`✗ ${msg}`);
    failed++;
  }
}
function resetChat() {
  useChatStore.setState({
    messagesBySession: {},
    idIndexBySession: {},
    loadingHistoryBySession: {},
    loadedHistoryBySession: {},
    loadingHistory: false,
    loadHistoryError: null,
    runner: null,
  });
  useInstancesStore.setState({
    instances: [],
    activeInstanceId: null,
    getClient: undefined as unknown as never,
  });
}

/** 注册一个 mock instance + client，让 chat-store.loadHistory 能拉数据。 */
function installClient(
  instanceId: string,
  agentId: string,
  client: {
    getSession: () => Promise<AgSessionDetail>;
    getSessionRuns: () => Promise<AgRunResponse[]>;
  }
) {
  useInstancesStore.setState({
    activeInstanceId: instanceId,
    instances: [
      {
        id: instanceId,
        name: "test",
        baseUrl: "http://localhost:0",
        agents: [{ id: agentId, name: agentId } as any],
        agentsFetchedAt: Date.now(),
      } as any,
    ],
    getClient: ((_id: string) => client) as any,
  });
}

/* ========================================================================
 * 主 fixture：user → outer-1 (CodeSearch) → sub-1 (MyCodebase)
 * ======================================================================== */
function buildOuter1Events(): AgRunResponse["events"] {
  return [
    { event: "RunStarted", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch", created_at: 1_783_300_000 },
    { event: "ModelRequestStarted", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch", created_at: 1_783_300_000 },
    { event: "ModelRequestCompleted", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch", created_at: 1_783_300_000 },
    {
      event: "ToolCallStarted", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch",
      tool: {
        tool_call_id: "call_outer_1",
        tool_name: "query_my_codebase",
        tool_args: { question: "列出项目目录" },
      },
      created_at: 1_783_300_001,
    },
    { event: "RunStarted", run_id: "sub-1", agent_id: "my-codebase", agent_name: "My Codebase", parent_run_id: "outer-1", created_at: 1_783_300_002 },
    { event: "ModelRequestStarted", run_id: "sub-1", agent_id: "my-codebase", agent_name: "My Codebase", parent_run_id: "outer-1", created_at: 1_783_300_002 },
    { event: "ModelRequestCompleted", run_id: "sub-1", agent_id: "my-codebase", agent_name: "My Codebase", parent_run_id: "outer-1", created_at: 1_783_300_002 },
    {
      event: "ToolCallStarted", run_id: "sub-1", agent_id: "my-codebase", agent_name: "My Codebase",
      tool: {
        tool_call_id: "call_sub_1a",
        tool_name: "list_files",
        tool_args: { directory: "/tmp", max_depth: 1 },
      },
      parent_run_id: "outer-1", created_at: 1_783_300_003,
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
      parent_run_id: "outer-1", created_at: 1_783_300_004,
    },
    { event: "ModelRequestStarted", run_id: "sub-1", agent_id: "my-codebase", agent_name: "My Codebase", parent_run_id: "outer-1", created_at: 1_783_300_005 },
    { event: "ModelRequestCompleted", run_id: "sub-1", agent_id: "my-codebase", agent_name: "My Codebase", parent_run_id: "outer-1", created_at: 1_783_300_005 },
    {
      event: "RunCompleted",
      run_id: "sub-1", agent_id: "my-codebase", agent_name: "My Codebase",
      content: "我看到项目目录有 a.txt。", parent_run_id: "outer-1",
      created_at: 1_783_300_006,
    },
    {
      event: "ToolCallCompleted", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch",
      tool: {
        tool_call_id: "call_outer_1",
        tool_name: "query_my_codebase",
        tool_args: { question: "列出项目目录" },
        result: "我看到项目目录有 a.txt。",
        tool_call_error: false,
      },
      created_at: 1_783_300_007,
    },
    { event: "ModelRequestStarted", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch", created_at: 1_783_300_008 },
    { event: "ModelRequestCompleted", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch", created_at: 1_783_300_008 },
    { event: "RunContent", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch", content: "目录里有 a.txt。", created_at: 1_783_300_009 },
    { event: "RunCompleted", run_id: "outer-1", agent_id: "code-search", agent_name: "CodeSearch", content: "目录里有 a.txt。", created_at: 1_783_300_010 },
  ] as any;
}

function buildOuter1Client(): {
  getSession: () => Promise<AgSessionDetail>;
  getSessionRuns: () => Promise<AgRunResponse[]>;
} {
  return {
    getSession: async (): Promise<AgSessionDetail> => ({
      session_id: "sess-fake",
      session_type: "agent",
      agent_id: "code-search",
      chat_history: [
        { id: "user-msg-1", role: "user", content: "列出项目目录", created_at: 1_783_300_000 } as AgChatMessage,
        {
          id: "assistant-msg-1", role: "assistant",
          content: "我来帮你查看。",
          tool_calls: [
            { id: "call_outer_1", type: "function", function: { name: "query_my_codebase", arguments: '{"question":"列出项目目录"}' } },
          ],
          created_at: 1_783_300_001,
        } as AgChatMessage,
        { id: "tool-msg-1", role: "tool", content: "我看到项目目录有 a.txt。", tool_call_id: "call_outer_1", created_at: 1_783_300_007 } as AgChatMessage,
        { id: "assistant-msg-2", role: "assistant", content: "目录里有 a.txt。", created_at: 1_783_300_010 } as AgChatMessage,
      ],
      agent_data: undefined, team_data: undefined, workflow_data: undefined,
    }),
    getSessionRuns: async (): Promise<AgRunResponse[]> => [
      { run_id: "outer-1", session_id: "sess-fake", agent_id: "code-search", agent_name: "CodeSearch", status: "COMPLETED", events: buildOuter1Events() } as any,
    ],
  };
}

// ─────────── 1) 主 fixture：events[] 抽取 + asst 合并 + marker ───────────
async function testEventsExtract() {
  console.log("=== events[] extraction: sub-agent 重建 + 工具 result + marker ===");
  resetChat();
  installClient("inst-fake", "code-search", buildOuter1Client());
  await useChatStore.getState().loadHistory("sess-fake");
  const messages = useChatStore.getState().messagesBySession["sess-fake"] ?? [];
  eq(messages.length, 2, "top: user + merged asst");

  const asst = messages.find((m) => m.id === "assistant-msg-1");
  assert(!!asst, "assistant-msg-1 present");
  if (!asst) return;

  const textParts = asst.parts.filter((p) => p.type === "text") as Array<{ text: string }>;
  const allText = textParts.map((p) => p.text).join("\n");
  assert(allText.includes("我来帮你查看") && allText.includes("目录里有 a.txt"), `merged text = ${JSON.stringify(allText)}`);
  eq(asst.parts.filter((p) => p.type === "tool_call").length, 1, "1 outer tool_call");

  const subs = asst.subMessages ?? [];
  eq(subs.length, 1, "1 sub (My Codebase)");
  if (subs.length === 1) {
    const sub = subs[0];
    eq(sub.runId, "sub-1", "sub.runId");
    eq(sub.displayName, "My Codebase", "sub.displayName");
    eq(sub.agentId, "my-codebase", "sub.agentId");
    eq(sub.parentMessageId, asst.id, "sub.parentMessageId");
    eq(sub.parts.filter((p) => p.type === "tool_call").length, 1, "sub: 1 tool_call");
    const subText = sub.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
    assert(subText.includes("我看到项目目录有 a.txt"), `sub text = ${JSON.stringify(subText)}`);
    const tool = sub.parts.find((p) => p.type === "tool_call") as { status?: string; result?: unknown };
    eq(tool?.status, "completed", "sub tool completed");
    assert(
      Array.isArray(tool?.result) || typeof tool?.result === "object",
      "sub tool.result parsed as object/array"
    );
  }
  eq(asst.parts.filter((p) => p.type === "sub_message_marker").length, 1, "1 marker");
}

// ─────────── 2) team mode (runs[].messages[]) ───────────
async function testTeamModeMessages() {
  console.log("=== team mode: from runs[].messages[] ===");
  resetChat();
  installClient("inst-1", "my-team", {
    getSession: async (): Promise<AgSessionDetail> => ({
      session_id: "sess-1",
      session_type: "team",
      team_id: "my-team",
      chat_history: [
        { id: "msg-user-1", role: "user", content: "What's the latest AI news?", created_at: 1_700_000_000 } as AgChatMessage,
        { id: "msg-team-1", role: "assistant", content: "Combining the results from web-search and code-search agents.", created_at: 1_700_000_001 } as AgChatMessage,
      ],
      agent_data: undefined, team_data: undefined, workflow_data: undefined,
    }),
    getSessionRuns: async (): Promise<AgRunResponse[]> => [
      {
        run_id: "team-1", parent_run_id: null, session_id: "sess-1", team_id: "my-team", agent_id: "my-team", status: "COMPLETED",
        messages: [
          { id: "msg-user-1", role: "user", content: "What's the latest AI news?", created_at: 1_700_000_000 } as AgChatMessage,
          { id: "msg-team-1", role: "assistant", content: "Combining the results from web-search and code-search agents.", created_at: 1_700_000_001 } as AgChatMessage,
        ],
      } as AgRunResponse,
      {
        run_id: "member-1", parent_run_id: "team-1", session_id: "sess-1", agent_id: "web-search", status: "COMPLETED",
        extra_data: { agent_name: "WebSearchAgent" } as any,
        messages: [
          {
            id: "msg-member1-assistant", role: "assistant", content: "Latest AI news: AGNO 2.6 released with team support.",
            reasoning_content: "Searching for the latest AI news 2026...",
            reasoning_steps: [{ title: "Search web", reasoning: "Use web_search tool" }],
            tool_calls: [{ tool_call_id: "tc-1", tool_name: "web_search", tool_args: { query: "latest AI news" }, result: '[{"title":"AGNO 2.6", "url":"https://x.com/agno"}]' }],
            created_at: 1_700_000_002,
          } as AgChatMessage,
        ],
      } as AgRunResponse,
      {
        run_id: "member-2", parent_run_id: "team-1", session_id: "sess-1", agent_id: "code-search", status: "COMPLETED",
        extra_data: { agent_name: "CodeSearchAgent" } as any,
        messages: [
          { id: "msg-member2-assistant", role: "assistant", content: "Found 3 references in the codebase.", created_at: 1_700_000_003 } as AgChatMessage,
        ],
      } as AgRunResponse,
    ],
  });
  await useChatStore.getState().loadHistory("sess-1");
  const messages = useChatStore.getState().messagesBySession["sess-1"] ?? [];
  eq(messages.length, 2, "top: user + team asst");
  const team = messages.find((m) => m.role === "assistant");
  if (!team) return;
  const subs = team.subMessages ?? [];
  eq(subs.length, 2, "2 sub-members");
  const sub1 = subs.find((s) => s.runId === "member-1");
  if (sub1) {
    eq(sub1.displayName, "WebSearchAgent", "member1 displayName from extra_data");
    assert(sub1.parts.some((p) => p.type === "tool_call"), "member1 has tool_call");
    assert(sub1.parts.some((p) => p.type === "reasoning"), "member1 has reasoning");
  }
  const sub2 = subs.find((s) => s.runId === "member-2");
  if (sub2) {
    eq(sub2.displayName, "CodeSearchAgent", "member2 displayName from extra_data");
    assert(!sub2.parts.some((p) => p.type === "tool_call"), "member2 no tools");
  }
}

// ─────────── 3) timestamp fallback ───────────
async function testTimestampFallback() {
  console.log("=== timestamp fallback: child runs 挂到时间窗口内的 assistant ===");
  resetChat();
  installClient("inst-X", "teamX", {
    getSession: async (): Promise<AgSessionDetail> => ({
      session_id: "sess-X",
      session_type: "team",
      team_id: "teamX",
      chat_history: [
        { id: "u-1", role: "user", content: "q1", created_at: 100 } as AgChatMessage,
        { id: "a-1", role: "assistant", content: "ans1", created_at: 110 } as AgChatMessage,
        { id: "u-2", role: "user", content: "q2", created_at: 200 } as AgChatMessage,
        { id: "a-2", role: "assistant", content: "ans2", created_at: 270 } as AgChatMessage,
      ],
      agent_data: undefined, team_data: undefined, workflow_data: undefined,
    }),
    getSessionRuns: async (): Promise<AgRunResponse[]> => [
      { run_id: "t-1", parent_run_id: null, session_id: "sess-X", team_id: "teamX", status: "COMPLETED", created_at: 105, messages: [{ id: "t-1-internal", role: "assistant", content: "team content 1" } as AgChatMessage] } as AgRunResponse,
      { run_id: "t-2", parent_run_id: null, session_id: "sess-X", team_id: "teamX", status: "COMPLETED", created_at: 220, messages: [{ id: "t-2-internal", role: "assistant", content: "team content 2" } as AgChatMessage] } as AgRunResponse,
      { run_id: "m-1", parent_run_id: "t-1", session_id: "sess-X", agent_id: "web-search", status: "COMPLETED", created_at: 108, messages: [{ id: "m-1-msg", role: "assistant", content: "search result 1", tool_calls: [{ tool_call_id: "tc-1", tool_name: "web_search", tool_args: { q: "x" }, result: "ok" }] } as AgChatMessage] } as AgRunResponse,
      { run_id: "m-2", parent_run_id: "t-2", session_id: "sess-X", agent_id: "code-search", status: "COMPLETED", created_at: 250, messages: [{ id: "m-2-msg", role: "assistant", content: "code result 2" } as AgChatMessage] } as AgRunResponse,
      { run_id: "m-3", parent_run_id: "t-1", session_id: "sess-X", agent_id: "another-agent", status: "COMPLETED", created_at: 115, messages: [{ id: "m-3-msg", role: "assistant", content: "another result" } as AgChatMessage] } as AgRunResponse,
    ],
  });
  await useChatStore.getState().loadHistory("sess-X");
  const messages = useChatStore.getState().messagesBySession["sess-X"] ?? [];
  eq(messages.length, 4, "4 top messages (user/asst × 2)");

  const a1 = messages.find((m) => m.id === "a-1");
  const a2 = messages.find((m) => m.id === "a-2");
  assert(!!a1, "a-1 present");
  assert(!!a2, "a-2 present");
  if (a1) {
    const subs = a1.subMessages ?? [];
    eq(subs.length, 2, `a-1 has 2 subs (m-1 + m-3), got ${subs.length}`);
    assert(!!subs.find((s) => s.runId === "m-1"), "m-1 attached to a-1");
    assert(!!subs.find((s) => s.runId === "m-3"), "m-3 attached to a-1");
    const markers = a1.parts.filter((p) => p.type === "sub_message_marker") as Array<{ subMessageId: string }>;
    eq(markers.length, 2, `a-1 has 2 markers, got ${markers.length}`);
  }
  if (a2) {
    const subs = a2.subMessages ?? [];
    eq(subs.length, 1, `a-2 has 1 sub (m-2), got ${subs.length}`);
    assert(!!subs.find((s) => s.runId === "m-2"), "m-2 attached to a-2");
  }
}

// ─────────── 4) marker 紧跟在 tool_call 后 ───────────
async function testMarkerPosition() {
  console.log("=== marker position: 紧跟在触发的 tool_call 之后 ===");
  resetChat();
  installClient("inst-pos", "outer", {
    getSession: async (): Promise<AgSessionDetail> => ({
      session_id: "sess-pos",
      session_type: "agent",
      agent_id: "outer",
      chat_history: [
        { id: "u1", role: "user", content: "do a then b", created_at: 1_783_499_999 } as AgChatMessage,
        {
          id: "a1", role: "assistant", content: "I'll call do_a then do_b.",
          tool_calls: [
            { id: "t1", type: "function", function: { name: "do_a", arguments: "{}" } },
            { id: "t2", type: "function", function: { name: "do_b", arguments: "{}" } },
          ],
          created_at: 1_783_500_011,
        } as AgChatMessage,
      ],
      agent_data: undefined, team_data: undefined, workflow_data: undefined,
    }),
    getSessionRuns: async (): Promise<AgRunResponse[]> => [
      {
        run_id: "o", session_id: "sess-pos", agent_id: "outer", agent_name: "Outer", status: "COMPLETED",
        events: [
          { event: "RunStarted", run_id: "o", agent_id: "outer", agent_name: "Outer", created_at: 1_783_500_000 },
          { event: "ToolCallStarted", run_id: "o", agent_id: "outer", agent_name: "Outer", tool: { tool_call_id: "t1", tool_name: "do_a", tool_args: {} }, created_at: 1_783_500_001 },
          { event: "RunStarted", run_id: "s1", agent_id: "agent_a", agent_name: "Agent A", parent_run_id: "o", created_at: 1_783_500_002 },
          { event: "ToolCallCompleted", run_id: "s1", agent_id: "agent_a", agent_name: "Agent A", tool: { tool_call_id: "ts1", tool_name: "sub_tool_a", tool_args: {}, result: "ok-1" }, parent_run_id: "o", created_at: 1_783_500_003 },
          { event: "RunCompleted", run_id: "s1", agent_id: "agent_a", agent_name: "Agent A", content: "sub1 done", parent_run_id: "o", created_at: 1_783_500_004 },
          { event: "ToolCallCompleted", run_id: "o", agent_id: "outer", agent_name: "Outer", tool: { tool_call_id: "t1", tool_name: "do_a", tool_args: {}, result: "ok" }, created_at: 1_783_500_005 },
          { event: "ToolCallStarted", run_id: "o", agent_id: "outer", agent_name: "Outer", tool: { tool_call_id: "t2", tool_name: "do_b", tool_args: {} }, created_at: 1_783_500_006 },
          { event: "RunStarted", run_id: "s2", agent_id: "agent_b", agent_name: "Agent B", parent_run_id: "o", created_at: 1_783_500_007 },
          { event: "ToolCallCompleted", run_id: "s2", agent_id: "agent_b", agent_name: "Agent B", tool: { tool_call_id: "ts2", tool_name: "sub_tool_b", tool_args: {}, result: "ok-2" }, parent_run_id: "o", created_at: 1_783_500_008 },
          { event: "RunCompleted", run_id: "s2", agent_id: "agent_b", agent_name: "Agent B", content: "sub2 done", parent_run_id: "o", created_at: 1_783_500_009 },
          { event: "ToolCallCompleted", run_id: "o", agent_id: "outer", agent_name: "Outer", tool: { tool_call_id: "t2", tool_name: "do_b", tool_args: {}, result: "ok" }, created_at: 1_783_500_010 },
          { event: "RunCompleted", run_id: "o", agent_id: "outer", agent_name: "Outer", content: "outer done", created_at: 1_783_500_011 },
        ] as any,
      },
    ],
  });
  await useChatStore.getState().loadHistory("sess-pos");
  const asst = (useChatStore.getState().messagesBySession["sess-pos"] ?? []).find((m) => m.id === "a1");
  assert(!!asst, "a1 present");
  if (!asst) return;
  const subs = asst.subMessages ?? [];
  eq(subs.length, 2, "2 subs");

  // 每个 marker 之前最近的 tool_call 就是触发的 tool_call_id
  const markers = asst.parts.map((p, i) => ({ p, i })).filter(({ p }) => (p as { type: string }).type === "sub_message_marker");
  eq(markers.length, 2, "2 markers");
  const beforeToolIds: string[] = [];
  for (const { i } of markers) {
    let j = i - 1;
    while (j >= 0 && (asst.parts[j] as { type: string }).type !== "tool_call") j--;
    if (j >= 0) beforeToolIds.push((asst.parts[j] as { toolCallId: string }).toolCallId);
  }
  eq(beforeToolIds.length, 2, "2 markers linked to tool_call");
  eq(beforeToolIds[0], "t1", "first marker follows t1 (Agent A)");
  eq(beforeToolIds[1], "t2", "second marker follows t2 (Agent B)");
}

// ─────────── 5) attachedRunIds dedup（Stage A + Stage B 同 sub）───────────
async function testAttachedRunIdsDedup() {
  console.log("=== attachedRunIds dedup: 同一 sub 在 events[] AND runs[].parent_run_id ===");
  resetChat();
  installClient("inst-f3", "team-3", {
    getSession: async (): Promise<AgSessionDetail> => ({
      session_id: "sess-f3",
      session_type: "team",
      team_id: "team-3",
      chat_history: [
        { id: "u-3", role: "user", content: "hi", created_at: 1_783_310_000 } as AgChatMessage,
        { id: "a-3", role: "assistant", content: "Outer reply.", tool_calls: [{ id: "tc-3-outer", type: "function", function: { name: "query_my_codebase", arguments: '{"question":"hi"}' } }], created_at: 1_783_310_005 } as AgChatMessage,
      ],
      agent_data: undefined, team_data: undefined, workflow_data: undefined,
    }),
    getSessionRuns: async (): Promise<AgRunResponse[]> => [
      {
        run_id: "outer-3", session_id: "sess-f3", team_id: "team-3", agent_id: "code-search", agent_name: "CodeSearch", status: "COMPLETED",
        events: [
          { event: "RunStarted", run_id: "outer-3", agent_id: "code-search", agent_name: "CodeSearch", created_at: 1_783_310_000 },
          { event: "ToolCallStarted", run_id: "outer-3", agent_id: "code-search", agent_name: "CodeSearch", tool: { tool_call_id: "tc-3-outer", tool_name: "query_my_codebase", tool_args: { question: "hi" } }, created_at: 1_783_310_001 },
          { event: "RunStarted", run_id: "sub-3", agent_id: "my-codebase", agent_name: "My Codebase", parent_run_id: "outer-3", created_at: 1_783_310_002 },
          { event: "RunCompleted", run_id: "sub-3", agent_id: "my-codebase", agent_name: "My Codebase", content: "Reply from sub.", parent_run_id: "outer-3", created_at: 1_783_310_003 },
          { event: "ToolCallCompleted", run_id: "outer-3", agent_id: "code-search", agent_name: "CodeSearch", tool: { tool_call_id: "tc-3-outer", tool_name: "query_my_codebase", tool_args: { question: "hi" }, result: "Reply from sub.", tool_call_error: false }, created_at: 1_783_310_004 },
          { event: "RunCompleted", run_id: "outer-3", agent_id: "code-search", agent_name: "CodeSearch", content: "Outer reply.", created_at: 1_783_310_005 },
        ] as any,
        parent_run_id: null,
      } as any,
      { run_id: "sub-3", session_id: "sess-f3", parent_run_id: "outer-3", agent_id: "my-codebase", agent_name: "My Codebase", status: "COMPLETED", messages: [], events: [] } as any,
    ],
  });
  await useChatStore.getState().loadHistory("sess-f3");
  const asst = (useChatStore.getState().messagesBySession["sess-f3"] ?? []).find((m) => m.role === "assistant");
  assert(!!asst, "asst present");
  if (!asst) return;
  const subs = asst.subMessages ?? [];
  const subInstances = subs.filter((s) => s.runId === "sub-3");
  eq(subInstances.length, 1, "sub-3 attached once (was the dedup bug)");
  const markers = asst.parts.filter(
    (p) => p.type === "sub_message_marker" && (p as { subMessageId: string }).subMessageId === subInstances[0]?.id
  );
  eq(markers.length, 1, "marker for sub-3 appears once");
}

// ─────────── 6) ToolCallStarted dedup（replay）───────────
async function testToolCallStartedDedup() {
  console.log("=== ToolCallStarted dedup: 同 tool_call_id 二次 Started args 合并 ===");
  resetChat();
  installClient("inst-f4", "code-search", {
    getSession: async (): Promise<AgSessionDetail> => ({
      session_id: "sess-f4",
      session_type: "agent",
      agent_id: "code-search",
      chat_history: [
        { id: "u-4", role: "user", content: "hi", created_at: 1_783_311_000 } as AgChatMessage,
        { id: "a-4", role: "assistant", content: "Done.", tool_calls: [{ id: "tc-4-outer", type: "function", function: { name: "query_my_codebase", arguments: '{"question":"v1"}' } }], created_at: 1_783_311_008 } as AgChatMessage,
      ],
      agent_data: undefined, team_data: undefined, workflow_data: undefined,
    }),
    getSessionRuns: async (): Promise<AgRunResponse[]> => [
      {
        run_id: "outer-4", session_id: "sess-f4", agent_id: "code-search", agent_name: "CodeSearch", status: "COMPLETED",
        events: [
          { event: "RunStarted", run_id: "outer-4", agent_id: "code-search", agent_name: "CodeSearch", created_at: 1_783_311_000 },
          { event: "ToolCallStarted", run_id: "outer-4", agent_id: "code-search", agent_name: "CodeSearch", tool: { tool_call_id: "tc-4-outer", tool_name: "query_my_codebase", tool_args: { question: "v1" } }, created_at: 1_783_311_001 },
          { event: "RunStarted", run_id: "sub-4", agent_id: "my-codebase", agent_name: "My Codebase", parent_run_id: "outer-4", created_at: 1_783_311_002 },
          { event: "ToolCallStarted", run_id: "sub-4", agent_id: "my-codebase", agent_name: "My Codebase", tool: { tool_call_id: "call_4_dup", tool_name: "list_files", tool_args: { directory: "/tmp" } }, parent_run_id: "outer-4", created_at: 1_783_311_003 },
          // DUPLICATE Started
          { event: "ToolCallStarted", run_id: "sub-4", agent_id: "my-codebase", agent_name: "My Codebase", tool: { tool_call_id: "call_4_dup", tool_name: "list_files", tool_args: { directory: "/var", max_depth: 2 } }, parent_run_id: "outer-4", created_at: 1_783_311_004 },
          { event: "ToolCallCompleted", run_id: "sub-4", agent_id: "my-codebase", agent_name: "My Codebase", tool: { tool_call_id: "call_4_dup", tool_name: "list_files", tool_args: { directory: "/var", max_depth: 2 }, result: JSON.stringify({ directory: "/var", files: [{ path: "b.txt" }] }), tool_call_error: false }, parent_run_id: "outer-4", created_at: 1_783_311_005 },
          { event: "RunCompleted", run_id: "sub-4", agent_id: "my-codebase", agent_name: "My Codebase", content: "ok", parent_run_id: "outer-4", created_at: 1_783_311_006 },
          { event: "ToolCallCompleted", run_id: "outer-4", agent_id: "code-search", agent_name: "CodeSearch", tool: { tool_call_id: "tc-4-outer", tool_name: "query_my_codebase", tool_args: { question: "v1" }, result: "ok", tool_call_error: false }, created_at: 1_783_311_007 },
          { event: "RunCompleted", run_id: "outer-4", agent_id: "code-search", agent_name: "CodeSearch", content: "Done.", created_at: 1_783_311_008 },
        ] as any,
      },
    ],
  });
  await useChatStore.getState().loadHistory("sess-f4");
  const asst = (useChatStore.getState().messagesBySession["sess-f4"] ?? []).find((m) => m.role === "assistant");
  assert(!!asst, "asst present");
  if (!asst) return;
  const subs = asst.subMessages ?? [];
  eq(subs.length, 1, "1 sub");
  if (subs.length === 1) {
    const toolParts = subs[0].parts.filter((p) => p.type === "tool_call");
    eq(toolParts.length, 1, `1 tool_call part (was the duplicate bug), got ${toolParts.length}`);
    eq((toolParts[0] as { args?: { directory?: string } }).args?.directory, "/var", "merged args take second Started");
    eq(toolParts[0]?.status, "completed", "tool_call completed");
  }
}

// ─────────── 7) ReasoningStep → parts.steps ───────────
async function testReasoningStep() {
  console.log("=== ReasoningStep events populate parts.steps ===");
  resetChat();
  installClient("inst-r7a", "code-search", {
    getSession: async (): Promise<AgSessionDetail> => ({
      session_id: "sess-r7a",
      session_type: "agent",
      agent_id: "code-search",
      chat_history: [
        { id: "u-r7a", role: "user", content: "list files", created_at: 1_783_500_000 } as AgChatMessage,
        { id: "a-r7a", role: "assistant", content: "ok", tool_calls: [{ id: "tc-r7a", type: "function", function: { name: "query_my_codebase", arguments: "{}" } }], created_at: 1_783_500_009 } as AgChatMessage,
      ],
      agent_data: undefined, team_data: undefined, workflow_data: undefined,
    }),
    getSessionRuns: async (): Promise<AgRunResponse[]> => [
      {
        run_id: "outer-r7a", session_id: "sess-r7a", agent_id: "code-search", agent_name: "CodeSearch", status: "COMPLETED",
        events: [
          { event: "RunStarted", run_id: "outer-r7a", agent_id: "code-search", agent_name: "CodeSearch", created_at: 1_783_500_000 },
          { event: "ToolCallStarted", run_id: "outer-r7a", agent_id: "code-search", agent_name: "CodeSearch", tool: { tool_call_id: "tc-r7a", tool_name: "query_my_codebase", tool_args: { question: "list files" } }, created_at: 1_783_500_001 },
          { event: "RunStarted", run_id: "sub-r7a", agent_id: "x", agent_name: "X", parent_run_id: "outer-r7a", created_at: 1_783_500_002 },
          { event: "ReasoningStep", run_id: "sub-r7a", agent_id: "x", agent_name: "X", reasoning_step: { title: "Plan", reasoning: "I'll list the dir" }, parent_run_id: "outer-r7a", created_at: 1_783_500_003 },
          { event: "ReasoningStep", run_id: "sub-r7a", agent_id: "x", agent_name: "X", reasoning_step: { title: "Read", reasoning: "I see a.txt" }, parent_run_id: "outer-r7a", created_at: 1_783_500_004 },
          { event: "ToolCallStarted", run_id: "sub-r7a", agent_id: "x", agent_name: "X", tool: { tool_call_id: "tc-sub-r7a", tool_name: "list_files" }, parent_run_id: "outer-r7a", created_at: 1_783_500_005 },
          { event: "ToolCallCompleted", run_id: "sub-r7a", agent_id: "x", agent_name: "X", tool: { tool_call_id: "tc-sub-r7a", tool_name: "list_files", result: "ok", tool_call_error: false }, parent_run_id: "outer-r7a", created_at: 1_783_500_006 },
          { event: "RunCompleted", run_id: "sub-r7a", agent_id: "x", agent_name: "X", content: "done", parent_run_id: "outer-r7a", created_at: 1_783_500_007 },
          { event: "ToolCallCompleted", run_id: "outer-r7a", agent_id: "code-search", agent_name: "CodeSearch", tool: { tool_call_id: "tc-r7a", tool_name: "query_my_codebase", result: "done", tool_call_error: false }, created_at: 1_783_500_008 },
          { event: "RunCompleted", run_id: "outer-r7a", agent_id: "code-search", agent_name: "CodeSearch", content: "ok", created_at: 1_783_500_009 },
        ] as any,
      },
    ],
  });
  await useChatStore.getState().loadHistory("sess-r7a");
  const asst = (useChatStore.getState().messagesBySession["sess-r7a"] ?? []).find((m) => m.role === "assistant");
  if (!asst) return;
  const subs = asst.subMessages ?? [];
  eq(subs.length, 1, "1 sub");
  const reasoning = subs[0]?.parts.find((p) => p.type === "reasoning") as { steps?: Array<{ title: string }> };
  assert(!!reasoning, "sub has reasoning part");
  eq(reasoning?.steps?.length, 2, "2 steps");
  eq(reasoning?.steps?.[0]?.title, "Plan", "step[0].title = Plan");
  eq(reasoning?.steps?.[1]?.title, "Read", "step[1].title = Read");
}

// ─────────── 8) sub-of-sub 父子链 ───────────
async function testSubOfSubParentChain() {
  console.log("=== sub-of-sub parent chain (按 parent_run_id 递归挂载) ===");
  resetChat();
  installClient("inst-r7b", "team-r7b", {
    getSession: async (): Promise<AgSessionDetail> => ({
      session_id: "sess-r7b",
      session_type: "team",
      team_id: "team-r7b",
      chat_history: [
        { id: "u-r7b", role: "user", content: "hi", created_at: 1_783_510_000 } as AgChatMessage,
        { id: "a-r7b", role: "assistant", content: "team reply", tool_calls: [{ id: "tc-team-r7b", type: "function", function: { name: "delegate", arguments: "{}" } }], created_at: 1_783_510_010 } as AgChatMessage,
      ],
      agent_data: undefined, team_data: undefined, workflow_data: undefined,
    }),
    getSessionRuns: async (): Promise<AgRunResponse[]> => [
      { run_id: "team-r7b", session_id: "sess-r7b", parent_run_id: null, team_id: "team-r7b", agent_id: "team-r7b", status: "COMPLETED",
        messages: [{ id: "a-r7b", role: "assistant", content: "team reply", tool_calls: [{ id: "tc-team-r7b", type: "function", function: { name: "delegate", arguments: "{}" } }], created_at: 1_783_510_010 } as AgChatMessage],
        events: [] } as any,
      { run_id: "agent-r7b", session_id: "sess-r7b", parent_run_id: "team-r7b", agent_id: "agent-r7b", status: "COMPLETED",
        messages: [{ id: "agent-msg-r7b", role: "assistant", content: "agent reply", tool_calls: [{ id: "tc-agent-r7b", type: "function", function: { name: "tool_call", arguments: "{}" } }], created_at: 1_783_510_005 } as AgChatMessage],
        events: [] } as any,
      { run_id: "tool-r7b", session_id: "sess-r7b", parent_run_id: "agent-r7b", agent_id: "tool-r7b", status: "COMPLETED",
        messages: [{ id: "tool-msg-r7b", role: "assistant", content: "tool reply", created_at: 1_783_510_008 } as AgChatMessage],
        events: [] } as any,
    ],
  });
  await useChatStore.getState().loadHistory("sess-r7b");
  const teamMsg = (useChatStore.getState().messagesBySession["sess-r7b"] ?? []).find((m) => m.id === "a-r7b");
  assert(!!teamMsg, "team msg present");
  if (!teamMsg) return;
  const teamSubs = teamMsg.subMessages ?? [];
  const agentSub = teamSubs.find((s) => s.runId === "agent-r7b");
  assert(!!agentSub, "agent-r7b attached as direct sub of team");
  const agentSubs = agentSub?.subMessages ?? [];
  const toolSub = agentSubs.find((s) => s.runId === "tool-r7b");
  assert(!!toolSub, "tool-r7b attached as sub-of-sub under agent-r7b");
  // tool-r7b NOT a sibling of agent
  const toolSibling = teamSubs.find((s) => s.runId === "tool-r7b");
  assert(!toolSibling, "tool-r7b NOT a sibling of agent-r7b (was the old flatten bug)");
}

// ─────────── 9) 空 assistant → debug log + 仍 drop ───────────
async function testEmptyAssistantDebug() {
  console.log("=== empty assistant: console.debug + still dropped ===");
  resetChat();
  const originalDebug = console.debug;
  const debugCalls: unknown[][] = [];
  console.debug = (...args: unknown[]) => debugCalls.push(args);
  try {
    installClient("inst-r7c", "agent-r7c", {
      getSession: async (): Promise<AgSessionDetail> => ({
        session_id: "sess-r7c",
        session_type: "agent",
        agent_id: "agent-r7c",
        chat_history: [
          { id: "u-r7c", role: "user", content: "hi", created_at: 1_783_520_000 } as AgChatMessage,
          { id: "a-r7c-empty", role: "assistant", content: "", created_at: 1_783_520_001 } as AgChatMessage,
          { id: "a-r7c-real", role: "assistant", content: "real reply", created_at: 1_783_520_002 } as AgChatMessage,
        ],
        agent_data: undefined, team_data: undefined, workflow_data: undefined,
      }),
      getSessionRuns: async () => [{ run_id: "agent-r7c", session_id: "sess-r7c", agent_id: "agent-r7c", status: "COMPLETED", events: [], messages: [] } as any],
    });
    await useChatStore.getState().loadHistory("sess-r7c");
    const dropLogs = debugCalls.filter((c) => String(c[0] ?? "").includes("dropping empty assistant"));
    assert(dropLogs.length >= 1, `console.debug called for empty assistant (got ${dropLogs.length})`);
    const msgs = useChatStore.getState().messagesBySession["sess-r7c"] ?? [];
    assert(!msgs.find((m) => m.id === "a-r7c-empty"), "empty assistant still dropped");
  } finally {
    console.debug = originalDebug;
  }
}

// ─────────── 10) events[] 缺 agent_name → warn ───────────
async function testNoAgentNameWarn() {
  console.log("=== events[] without agent_name → console.warn ===");
  resetChat();
  const originalWarn = console.warn;
  const warnCalls: unknown[][] = [];
  console.warn = (...args: unknown[]) => warnCalls.push(args);
  try {
    installClient("inst-r7d", "agent-r7d", {
      getSession: async (): Promise<AgSessionDetail> => ({
        session_id: "sess-r7d",
        session_type: "agent",
        agent_id: "agent-r7d",
        chat_history: [
          { id: "u-r7d", role: "user", content: "hi", created_at: 1_783_530_000 } as AgChatMessage,
          { id: "a-r7d", role: "assistant", content: "done", created_at: 1_783_530_002 } as AgChatMessage,
        ],
        agent_data: undefined, team_data: undefined, workflow_data: undefined,
      }),
      getSessionRuns: async () => [
        { run_id: "outer-r7d", session_id: "sess-r7d", agent_id: "agent-r7d", status: "COMPLETED",
          events: [
            { event: "RunStarted", run_id: "outer-r7d", created_at: 1_783_530_000 },
            { event: "ToolCallStarted", run_id: "outer-r7d", tool: { tool_call_id: "tc-r7d", tool_name: "noop" }, created_at: 1_783_530_001 },
            { event: "RunCompleted", run_id: "outer-r7d", content: "done", created_at: 1_783_530_002 },
          ] } as any,
      ],
    });
    await useChatStore.getState().loadHistory("sess-r7d");
    const logs = warnCalls.filter((c) => String(c[0] ?? "").includes("events[] present but no agent_name"));
    assert(logs.length >= 1, `console.warn called for no-agent_name events[] (got ${logs.length})`);
  } finally {
    console.warn = originalWarn;
  }
}

// ─────────── 11) buildSubFromEvents 把负 durationMs clamp 到 ≥0 ───────────
async function testSubDurationClamp() {
  console.log("=== buildSubFromEvents: out-of-order events → durationMs ≥ 0 ===");
  resetChat();
  installClient("inst-od", "outer-od", {
    getSession: async (): Promise<AgSessionDetail> => ({
      session_id: "sess-od",
      session_type: "agent",
      agent_id: "outer-od",
      chat_history: [
        { id: "u-od", role: "user", content: "hi", created_at: 1_000_000_000 } as AgChatMessage,
        { id: "a-od", role: "assistant", content: "outer reply", tool_calls: [{ id: "tc-outer-od", type: "function", function: { name: "noop", arguments: "{}" } }], created_at: 1_000_000_010 } as AgChatMessage,
      ],
      agent_data: undefined, team_data: undefined, workflow_data: undefined,
    }),
    getSessionRuns: async () => [
      { run_id: "outer-od", session_id: "sess-od", agent_id: "outer-od", agent_name: "Outer", status: "COMPLETED",
        parent_run_id: null,
        events: [
          { event: "RunStarted", run_id: "outer-od", agent_id: "outer-agent", agent_name: "Outer", created_at: 1_000_000_000 },
          { event: "ToolCallStarted", run_id: "outer-od", agent_id: "outer-agent", agent_name: "Outer", created_at: 1_000_000_001, tool: { tool_call_id: "tc-outer-od", tool_name: "delegate_to_sub" } },
          { event: "RunStarted", run_id: "sub-od", agent_id: "x", agent_name: "X", created_at: 1_000_000_002, parent_run_id: "outer-od" },
          { event: "ToolCallStarted", run_id: "sub-od", agent_id: "x", agent_name: "X", created_at: 500_000_000, parent_run_id: "outer-od", tool: { tool_call_id: "tc-od", tool_name: "noop" } }, // earlier!
          { event: "ToolCallCompleted", run_id: "sub-od", agent_id: "x", agent_name: "X", created_at: 1_000_000_005, parent_run_id: "outer-od", tool: { tool_call_id: "tc-od", tool_name: "noop", result: "ok", tool_call_error: false } },
          { event: "RunCompleted", run_id: "sub-od", agent_id: "x", agent_name: "X", created_at: 500_000_001, parent_run_id: "outer-od", content: "done" },
          { event: "ToolCallCompleted", run_id: "outer-od", agent_id: "outer-agent", agent_name: "Outer", created_at: 1_000_000_006, tool: { tool_call_id: "tc-outer-od", tool_name: "delegate_to_sub", result: "done", tool_call_error: false } },
          { event: "RunCompleted", run_id: "outer-od", agent_id: "outer-agent", agent_name: "Outer", created_at: 1_000_000_007, content: "outer reply" },
        ] as any,
      } as any,
    ],
  });
  await useChatStore.getState().loadHistory("sess-od");
  const asst = (useChatStore.getState().messagesBySession["sess-od"] ?? []).find((m) => m.role === "assistant");
  assert(!!asst, "asst present");
  if (!asst) return;
  const subs = asst.subMessages ?? [];
  eq(subs.length, 1, "1 sub");
  const duration = (subs[0]?.metrics as { duration?: number } | undefined)?.duration;
  assert(
    duration === undefined || (typeof duration === "number" && duration >= 0),
    `sub.metrics.duration = ${duration}; 负值已 clamp`
  );
}

// ─────────── helper: JSON 相等 ───────────
function eq<T>(actual: T, expected: T, msg: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

// ─────────── main ───────────
async function main(): Promise<void> {
  await testEventsExtract();
  await testTeamModeMessages();
  await testTimestampFallback();
  await testMarkerPosition();
  await testAttachedRunIdsDedup();
  await testToolCallStartedDedup();
  await testReasoningStep();
  await testSubOfSubParentChain();
  await testEmptyAssistantDebug();
  await testNoAgentNameWarn();
  await testSubDurationClamp();
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