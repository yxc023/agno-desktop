/**
 * Test: per-session loading/loaded state in chat-store
 *
 * Verifies the fix for the "click session → see welcome screen → see messages"
 * flicker:
 *   - clicking a session → loadingHistoryBySession[id] flips to true
 *   - history lands → loadedHistoryBySession[id] flips to true
 *   - setMessages resets loading flag and marks loaded
 *   - LRU eviction cleans up the per-session flags
 *   - clearMessages drops the flags too
 *
 * Usage:
 *   bun test tests/per-session-loading-state.test.ts
 */
import { useChatStore } from "../src/stores/chat-store";
import { useInstancesStore } from "../src/stores/instances-store";

// —— stub AGNO client ——
function makeFakeClient(opts: { delayMs?: number } = {}) {
  const delay = opts.delayMs ?? 0;
  return {
    getSession: async (sessionId: string) => {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      return {
        session_id: sessionId,
        agent_id: "fake-agent",
        chat_history: [],
      };
    },
    getSessionRuns: async () => {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      return [];
    },
  };
}

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed++;
    console.error(`✗ ${msg}`);
  } else {
    console.log(`✓ ${msg}`);
  }
}

async function main(): Promise<void> {
  // 在 instances-store 注入 fake active instance 和 client
  useInstancesStore.setState((s) => ({
    ...s,
    activeInstanceId: "fake-instance",
    instances: [
      ...(s.instances ?? []),
      {
        id: "fake-instance",
        name: "Fake",
        baseUrl: "http://fake",
        token: null,
        agents: [],
        lastInfo: { agno_version: "test" } as any,
        agentsFetchedAt: 0,
        lastProbeAt: Date.now(),
      } as any,
    ],
  }));
  // 注入 client factory (slow fake, 80ms 网络延迟)
  useInstancesStore.setState((s) => ({
    ...s,
    getClient: ((_id: string) => makeFakeClient({ delayMs: 80 })) as any,
  }));

  const sessionA = "session-A";
  const sessionB = "session-B";

  // —— 初始状态 ——
  let s = useChatStore.getState();
  assert(
    s.loadingHistoryBySession[sessionA] === undefined,
    "loadingHistoryBySession[A] initially undefined"
  );
  assert(
    s.loadedHistoryBySession[sessionA] === undefined,
    "loadedHistoryBySession[A] initially undefined"
  );

  // —— 启动 A 的 loadHistory（不 await，让它跑） ——
  const promiseA = useChatStore.getState().loadHistory(sessionA);

  // 给 setState 一个 microtask 让他跑（80ms 的 client delay 还没回来）
  await new Promise((r) => setTimeout(r, 20));
  s = useChatStore.getState();
  assert(
    s.loadingHistoryBySession[sessionA] === true,
    "loadingHistoryBySession[A] flips to true after loadHistory starts"
  );
  assert(
    s.loadedHistoryBySession[sessionA] !== true,
    "loadedHistoryBySession[A] NOT yet true during load"
  );

  await promiseA;
  s = useChatStore.getState();
  assert(
    s.loadingHistoryBySession[sessionA] === false,
    "loadingHistoryBySession[A] back to false after load completes"
  );
  assert(
    s.loadedHistoryBySession[sessionA] === true,
    "loadedHistoryBySession[A] flips to true after load completes"
  );

  // —— setMessages 也应该把 loading 置 false、loaded 置 true ——
  useChatStore.setState((s) => ({
    loadingHistoryBySession: { ...s.loadingHistoryBySession, sessionB: true },
    loadedHistoryBySession: { ...s.loadedHistoryBySession, sessionB: false },
  }));
  useChatStore.getState().setMessages(sessionB, []);
  s = useChatStore.getState();
  assert(
    s.loadingHistoryBySession[sessionB] === false,
    "setMessages clears loading flag for that session"
  );
  assert(
    s.loadedHistoryBySession[sessionB] === true,
    "setMessages marks session as loaded"
  );

  // —— clearMessages 应该清掉 flags ——
  useChatStore.setState((s) => ({
    loadingHistoryBySession: { ...s.loadingHistoryBySession, sessionA: true },
    loadedHistoryBySession: { ...s.loadedHistoryBySession, sessionA: true },
  }));
  useChatStore.getState().clearMessages(sessionA);
  s = useChatStore.getState();
  assert(
    s.loadingHistoryBySession[sessionA] === undefined,
    "clearMessages removes loading flag"
  );
  assert(
    s.loadedHistoryBySession[sessionA] === undefined,
    "clearMessages removes loaded flag"
  );

  // —— LRU 收紧：把很多 session 推进去 ——
  // 关键路径是 setMessages 内部的 pruneMessagesBySession 调用，
  // 它会同时丢弃被 evict 的 session 在 loading/loaded flags 里的条目。
  const manySessions: string[] = [];
  for (let i = 0; i < 30; i++) {
    const id = `lru-test-${i}`;
    manySessions.push(id);
    useChatStore.setState((s) => ({
      loadingHistoryBySession: { ...s.loadingHistoryBySession, [id]: false },
      loadedHistoryBySession: { ...s.loadedHistoryBySession, [id]: true },
    }));
    useChatStore.getState().setMessages(id, []);
  }
  s = useChatStore.getState();
  // MESSAGES_BY_SESSION_LRU_LIMIT = 20，所以前面的应该被 evict
  assert(
    s.loadedHistoryBySession[manySessions[0]] === undefined,
    `LRU: ${manySessions[0]} should be evicted from loadedHistoryBySession (got ${s.loadedHistoryBySession[manySessions[0]]})`
  );
  assert(
    s.loadedHistoryBySession[manySessions[manySessions.length - 1]] === true,
    `LRU: ${manySessions[manySessions.length - 1]} should be kept in loadedHistoryBySession`
  );
  assert(
    s.loadingHistoryBySession[manySessions[0]] === undefined,
    `LRU: ${manySessions[0]} should be evicted from loadingHistoryBySession`
  );

  console.log(
    `\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});