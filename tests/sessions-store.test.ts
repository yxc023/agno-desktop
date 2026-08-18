/**
 * tests/sessions-store.test.ts
 *
 * sessions-store 的核心契约（v0.0.13+）：
 *   - 初始 loadSessions 用 limit=15, page=1
 *   - loadMoreSessions 拉下一页并 append
 *   - hasMore / totalCount 来自 meta.total_count
 *   - total_pages 缺失时从 total_count / limit 兜底
 *   - loadMore 在已无更多 / 正在翻页时 no-op
 *   - removeSession 同步减 totalCount
 *   - session_id 去重（防御 AGNO 在 page 边界偶发重复）
 *   - 缓存命中：未 force 时不重新拉
 *   - _agentId / _client / _userId 通过 setContext 注入；测试用 setContext
 *     把 mock client + agentId 注入到 store
 *
 * AGNO /sessions 接口在某些版本上 limit=100 很慢。把默认拉取量降到 15，
 * 后续让用户主动点"加载更多"。本测试守住"少拉、按需拉"的核心契约。
 */
/* oxlint-disable */

import { useSessionsStore } from "../src/stores/sessions-store";
import type { AgSessionSummary, AgPaginatedResponse } from "../src/lib/agno-types";

// ─────────── assert framework ───────────
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.log(`✗ ${msg}`);
    failed++;
  }
}
function eq(actual: unknown, expected: unknown, msg: string): void {
  assert(
    actual === expected,
    `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

// ─────────── helpers ───────────

function makeSession(id: string, name?: string): AgSessionSummary {
  return {
    session_id: id,
    session_name: name ?? `session-${id}`,
    session_type: "agent",
    agent_id: "agent-1",
    created_at: 1700000000,
    updated_at: 1700000000,
  };
}

function makePaginatedResponse(
  ids: string[],
  meta: Partial<NonNullable<AgPaginatedResponse<unknown>["meta"]>> = {}
): AgPaginatedResponse<AgSessionSummary> {
  return {
    data: ids.map((id) => makeSession(id)),
    meta: { limit: 15, page: 1, ...meta },
  };
}

/**
 * 把 mock client + agentId + userId 注入到 sessions-store（v0.0.13+ 用 setContext
 * 而非 useInstancesStore）。返回 restore() 用于测试间清理。
 */
function setupMockContext(opts?: {
  responses?: Record<number, AgPaginatedResponse<AgSessionSummary>>;
  agentId?: string;
  userId?: string;
  listSessionsImpl?: (params: any) => Promise<AgPaginatedResponse<AgSessionSummary>>;
}) {
  const agentId = opts?.agentId ?? "agent-1";
  const userId = opts?.userId;
  const responses = opts?.responses ?? {};
  const listSessionsImpl =
    opts?.listSessionsImpl ??
    (async (params: { page?: number; limit?: number }) => {
      const page = params?.page ?? 1;
      if (responses[page]) return responses[page];
      return makePaginatedResponse([], { total_count: 0, total_pages: 0 });
    });

  const mockClient = {
    listSessions: listSessionsImpl,
    deleteSession: async () => {},
  };

  useSessionsStore.getState().setContext({
    client: mockClient as any,
    agentId,
    userId,
  });

  return {
    agentId,
    userId,
    listSessions: listSessionsImpl,
    restore: () => {
      useSessionsStore.getState().clearContext();
    },
  };
}

function resetSessionsStore() {
  useSessionsStore.setState({
    byAgent: {},
    pagination: {},
    sessionsUserId: {},
    loading: false,
    loadingMore: false,
    loadError: {},
  });
}

// ─────────── tests ───────────

async function main(): Promise<void> {
  console.log("=== 初始 loadSessions 用 limit=15 page=1 ===");
  {
    resetSessionsStore();
    const ctx = setupMockContext({
      responses: {
        1: makePaginatedResponse(
          Array.from({ length: 15 }, (_, i) => `s-${i + 1}`),
          { total_count: 42, total_pages: 3 }
        ),
      },
    });
    try {
      const list = await useSessionsStore
        .getState()
        .loadSessions(ctx.agentId);
      eq(list.length, 15, "首次返回 15 条");
      const pg = useSessionsStore.getState().pagination[ctx.agentId];
      assert(pg !== null && pg !== undefined, "pagination 已记录");
      eq(pg?.page, 1, "page = 1");
      eq(pg?.limit, 15, "limit = 15");
      eq(pg?.totalCount, 42, "totalCount = 42");
      eq(pg?.hasMore, true, "还有更多页（page 1 < total_pages 3）");
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== loadMoreSessions 拉下一页并 append ===");
  {
    resetSessionsStore();
    const ctx = setupMockContext({
      responses: {
        1: makePaginatedResponse(
          Array.from({ length: 15 }, (_, i) => `s-${i + 1}`),
          { total_count: 42, total_pages: 3 }
        ),
        2: makePaginatedResponse(
          Array.from({ length: 15 }, (_, i) => `s-${i + 16}`),
          { total_count: 42, total_pages: 3 }
        ),
        3: makePaginatedResponse(
          Array.from({ length: 12 }, (_, i) => `s-${i + 31}`),
          { total_count: 42, total_pages: 3 }
        ),
      },
    });
    try {
      await useSessionsStore.getState().loadSessions(ctx.agentId);
      await useSessionsStore.getState().loadMoreSessions(ctx.agentId);
      const list = useSessionsStore.getState().byAgent[ctx.agentId];
      eq(list.length, 30, "page1 + page2 = 30 条");
      const pg = useSessionsStore.getState().pagination[ctx.agentId];
      eq(pg?.page, 2, "page = 2");
      eq(pg?.hasMore, true, "还有 page 3 → hasMore = true");

      await useSessionsStore.getState().loadMoreSessions(ctx.agentId);
      const list2 = useSessionsStore.getState().byAgent[ctx.agentId];
      eq(list2.length, 42, "page1+2+3 = 42 条");
      const pg2 = useSessionsStore.getState().pagination[ctx.agentId];
      eq(pg2?.page, 3, "page = 3");
      eq(pg2?.hasMore, false, "已是最后一页 → hasMore = false");
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== hasMore=false 时 loadMore no-op ===");
  {
    resetSessionsStore();
    const ctx = setupMockContext({
      responses: {
        1: makePaginatedResponse(
          Array.from({ length: 5 }, (_, i) => `s-${i + 1}`),
          { total_count: 5, total_pages: 1 }
        ),
      },
    });
    try {
      await useSessionsStore.getState().loadSessions(ctx.agentId);
      const before = useSessionsStore.getState().byAgent[ctx.agentId]
        .length;
      await useSessionsStore.getState().loadMoreSessions(ctx.agentId);
      const after = useSessionsStore.getState().byAgent[ctx.agentId].length;
      eq(after, before, "hasMore=false 时不追加");
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== loadMore 并发点击下只触发一次 ===");
  {
    resetSessionsStore();
    let page2Calls = 0;
    const ctx = setupMockContext({
      responses: {
        1: makePaginatedResponse(
          Array.from({ length: 15 }, (_, i) => `s-${i + 1}`),
          { total_count: 30, total_pages: 2 }
        ),
      },
      listSessionsImpl: async (params: any) => {
        if (params?.page === 2) {
          page2Calls++;
          await new Promise((r) => setTimeout(r, 20));
          return makePaginatedResponse(
            Array.from({ length: 15 }, (_, i) => `s-${i + 16}`),
            { total_count: 30, total_pages: 2 }
          );
        }
        if (params?.page === 1) {
          return makePaginatedResponse(
            Array.from({ length: 15 }, (_, i) => `s-${i + 1}`),
            { total_count: 30, total_pages: 2 }
          );
        }
        return makePaginatedResponse([], { total_count: 0, total_pages: 0 });
      },
    });
    try {
      await useSessionsStore.getState().loadSessions(ctx.agentId);
      await Promise.all([
        useSessionsStore.getState().loadMoreSessions(ctx.agentId),
        useSessionsStore.getState().loadMoreSessions(ctx.agentId),
        useSessionsStore.getState().loadMoreSessions(ctx.agentId),
      ]);
      eq(page2Calls, 1, "page=2 只调用一次（loadingMore 锁）");
      const list = useSessionsStore.getState().byAgent[ctx.agentId];
      eq(list.length, 30, "最终 30 条（没有重复追加）");
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== session_id 重复时去重 ===");
  {
    resetSessionsStore();
    const ctx = setupMockContext({
      responses: {
        1: makePaginatedResponse(
          Array.from({ length: 15 }, (_, i) => `s-${i + 1}`),
          { total_count: 30, total_pages: 2 }
        ),
        2: makePaginatedResponse(
          [
            ...Array.from({ length: 5 }, (_, i) => `s-${i + 11}`),
            ...Array.from({ length: 10 }, (_, i) => `s-${i + 16}`),
          ],
          { total_count: 30, total_pages: 2 }
        ),
      },
    });
    try {
      await useSessionsStore.getState().loadSessions(ctx.agentId);
      await useSessionsStore.getState().loadMoreSessions(ctx.agentId);
      const list = useSessionsStore.getState().byAgent[ctx.agentId];
      eq(list.length, 25, "重复的 session_id 被去重");
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== removeSession 同步 totalCount ===");
  {
    resetSessionsStore();
    const ctx = setupMockContext({
      responses: {
        1: makePaginatedResponse(
          Array.from({ length: 15 }, (_, i) => `s-${i + 1}`),
          { total_count: 42, total_pages: 3 }
        ),
      },
    });
    try {
      await useSessionsStore.getState().loadSessions(ctx.agentId);
      await useSessionsStore
        .getState()
        .removeSession(ctx.agentId, "s-1");
      const pg = useSessionsStore.getState().pagination[ctx.agentId];
      eq(pg?.totalCount, 41, "删除一条后 totalCount -1");
      const list = useSessionsStore.getState().byAgent[ctx.agentId];
      eq(list.length, 14, "列表同步 -1");
      assert(!list.find((s) => s.session_id === "s-1"), "s-1 已被移除");
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== total_count 缺失时从 list.length 兜底 ===");
  {
    resetSessionsStore();
    const ctx = setupMockContext({
      responses: {
        1: {
          data: Array.from({ length: 15 }, (_, i) =>
            makeSession(`x-${i + 1}`)
          ),
          meta: { limit: 15, page: 1 },
        },
      },
    });
    try {
      await useSessionsStore.getState().loadSessions(ctx.agentId);
      const pg = useSessionsStore.getState().pagination[ctx.agentId];
      eq(pg?.totalCount, 15, "totalCount 兜底为 list.length");
      eq(pg?.hasMore, false, "total_pages=1 → 无更多");
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== 缓存命中：再次 loadSessions 不重新拉 ===");
  {
    resetSessionsStore();
    let callCount = 0;
    const ctx = setupMockContext({
      responses: {
        1: makePaginatedResponse(
          Array.from({ length: 15 }, (_, i) => `s-${i + 1}`),
          { total_count: 15, total_pages: 1 }
        ),
      },
      listSessionsImpl: async (params: any) => {
        callCount++;
        return makePaginatedResponse(
          Array.from({ length: 15 }, (_, i) => `s-${i + 1}`),
          { total_count: 15, total_pages: 1 }
        );
      },
    });
    try {
      await useSessionsStore.getState().loadSessions(ctx.agentId);
      await useSessionsStore.getState().loadSessions(ctx.agentId);
      eq(callCount, 1, "第二次 loadSessions 没触发新请求（缓存命中）");
      await useSessionsStore.getState().loadSessions(ctx.agentId, true);
      eq(callCount, 2, "force=true 强制重新拉");
    } finally {
      ctx.restore();
    }
  }

  console.log(
    `\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`
  );
}

// ────────────────────────────────────────────────────────────────
//  user_id 过滤（通过 _userId 注入）
// ────────────────────────────────────────────────────────────────

async function userIdTests(): Promise<void> {
  console.log("\n=== loadSessions 把 _userId 透传给 listSessions ===");
  {
    resetSessionsStore();
    let lastParams: any = null;
    const ctx = setupMockContext({
      userId: "mike",
      responses: {
        1: {
          data: [makeSession("s-1"), makeSession("s-2")],
          meta: { limit: 15, page: 1, total_count: 2, total_pages: 1 },
        },
      },
      listSessionsImpl: async (params: any) => {
        lastParams = params;
        return {
          data: [makeSession("s-1"), makeSession("s-2")],
          meta: { limit: 15, page: 1, total_count: 2, total_pages: 1 },
        };
      },
    });
    try {
      await useSessionsStore.getState().loadSessions(ctx.agentId);
      eq(lastParams?.user_id, "mike", "listSessions 收到 user_id='mike'");
      eq(
        useSessionsStore.getState().sessionsUserId[ctx.agentId],
        "mike",
        "sessionsUserId 记录 mike"
      );
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== userId 为空时不传 user_id ===");
  {
    resetSessionsStore();
    let lastParams: any = null;
    const ctx = setupMockContext({
      responses: {
        1: {
          data: [makeSession("s-1")],
          meta: { limit: 15, page: 1, total_count: 1, total_pages: 1 },
        },
      },
      listSessionsImpl: async (params: any) => {
        lastParams = params;
        return {
          data: [makeSession("s-1")],
          meta: { limit: 15, page: 1, total_count: 1, total_pages: 1 },
        };
      },
    });
    try {
      await useSessionsStore.getState().loadSessions(ctx.agentId);
      assert(
        !("user_id" in (lastParams ?? {})) || lastParams?.user_id === undefined,
        "user_id 未透传（undefined）"
      );
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== 服务端返回混合 user_id 时客户端 defensive 过滤 ===");
  {
    resetSessionsStore();
    const ctx = setupMockContext({
      userId: "mike",
      listSessionsImpl: async () => ({
        data: [
          { ...makeSession("s-mike-1"), user_id: "mike" },
          { ...makeSession("s-alice-1"), user_id: "alice" },
          { ...makeSession("s-no-uid"), user_id: undefined },
        ],
        meta: { limit: 15, page: 1, total_count: 3, total_pages: 1 },
      }),
    });
    try {
      const list = await useSessionsStore.getState().loadSessions(ctx.agentId);
      eq(list.length, 2, "只保留 mike 的 + 无 user_id 的（兜底），过滤掉 alice");
      assert(
        list.find((s) => s.session_id === "s-mike-1"),
        "保留 mike 的 session"
      );
      assert(
        list.find((s) => s.session_id === "s-no-uid"),
        "保留 user_id 缺失的 session（兜底）"
      );
      assert(
        !list.find((s) => s.session_id === "s-alice-1"),
        "过滤掉 alice 的 session"
      );
      const pg = useSessionsStore.getState().pagination[ctx.agentId];
      eq(pg?.totalCount, 3, "totalCount 来自 meta.total_count");
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== 改 userId → 下次 loadSessions 强制重拉 ===");
  {
    resetSessionsStore();
    let callCount = 0;
    const ctx = setupMockContext({
      userId: "mike",
      listSessionsImpl: async () => {
        callCount++;
        return {
          data: [makeSession("s-1")],
          meta: { limit: 15, page: 1, total_count: 1, total_pages: 1 },
        };
      },
    });
    try {
      await useSessionsStore.getState().loadSessions(ctx.agentId);
      eq(callCount, 1, "首次拉 1 次");
      await useSessionsStore.getState().loadSessions(ctx.agentId);
      eq(callCount, 1, "userId 未变 + 有缓存 → 不重拉");

      useSessionsStore.getState().setContext({
        client: useSessionsStore.getState()._client,
        agentId: ctx.agentId,
        userId: "alice",
      });
      await useSessionsStore.getState().loadSessions(ctx.agentId);
      eq(callCount, 2, "userId 变了 → 强制重拉");
      eq(
        useSessionsStore.getState().sessionsUserId[ctx.agentId],
        "alice",
        "sessionsUserId 更新到 alice"
      );
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== loadMoreSessions 也透传 user_id ===");
  {
    resetSessionsStore();
    const seenParams: any[] = [];
    const ctx = setupMockContext({
      userId: "mike",
      listSessionsImpl: async (params: any) => {
        seenParams.push(params);
        const page = params?.page ?? 1;
        return makePaginatedResponse(
          Array.from({ length: 15 }, (_, i) =>
            page === 1 ? `s-${i + 1}` : `s-${i + 16}`
          ),
          { total_count: 30, total_pages: 2 }
        );
      },
    });
    try {
      await useSessionsStore.getState().loadSessions(ctx.agentId);
      await useSessionsStore.getState().loadMoreSessions(ctx.agentId);
      eq(seenParams.length, 2, "load + loadMore 共 2 次请求");
      eq(seenParams[0]?.user_id, "mike", "load 透传 mike");
      eq(seenParams[1]?.user_id, "mike", "loadMore 也透传 mike");
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== clearSessionsCache 清掉缓存 + pagination + sessionsUserId ===");
  {
    resetSessionsStore();
    const ctx = setupMockContext({
      responses: {
        1: makePaginatedResponse(
          Array.from({ length: 5 }, (_, i) => `s-${i + 1}`),
          { total_count: 5, total_pages: 1 }
        ),
      },
    });
    try {
      await useSessionsStore.getState().loadSessions(ctx.agentId);
      assert(
        useSessionsStore.getState().byAgent[ctx.agentId]?.length === 5,
        "缓存有 5 条"
      );
      useSessionsStore.getState().clearSessionsCache(ctx.agentId);
      assert(
        !useSessionsStore.getState().byAgent[ctx.agentId],
        "byAgent 清掉"
      );
      assert(
        !useSessionsStore.getState().pagination[ctx.agentId],
        "pagination 清掉"
      );
      assert(
        !useSessionsStore.getState().sessionsUserId[ctx.agentId],
        "sessionsUserId 清掉"
      );
    } finally {
      ctx.restore();
    }
  }

  console.log(
    `\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`
  );
}

main()
  .then(() => userIdTests())
  .then(() => {
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });