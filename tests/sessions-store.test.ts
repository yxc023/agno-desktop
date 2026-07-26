/**
 * tests/sessions-store.test.ts
 *
 * sessions-store 的核心契约：
 *   - 初始 loadSessions 用 limit=15, page=1
 *   - loadMoreSessions 拉下一页并 append
 *   - hasMore / totalCount 来自 meta.total_count
 *   - total_pages 缺失时从 total_count / limit 兜底
 *   - loadMore 在已无更多 / 正在翻页时 no-op
 *   - removeSession 同步减 totalCount
 *   - session_id 去重（防御 AGNO 在 page 边界偶发重复）
 *   - 缓存命中：未 force 时不重新拉
 *
 * AGNO /sessions 接口在某些版本上 limit=100 很慢。把默认拉取量降到 15，
 * 后续让用户主动点"加载更多"。本测试守住"少拉、按需拉"的核心契约。
 *
 * 后续要补的实例管理 / search / rename / delete 相关测试也加到这里。
 */
/* oxlint-disable */

import { useSessionsStore } from "../src/stores/sessions-store";
import { useInstancesStore } from "../src/stores/instances-store";
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
 * 挂一个 mock instance + mock client，让 sessions-store 能拉数据。
 * page=1 响应通过 `responses[1]` 注入；page=2 / page=3 同理。
 */
function setupMockInstance(opts?: {
  responses?: Record<number, AgPaginatedResponse<AgSessionSummary>>;
}) {
  const responses = opts?.responses ?? {};
  const listSessions = async (params: { page?: number; limit?: number }) => {
    const page = params?.page ?? 1;
    if (responses[page]) return responses[page];
    return makePaginatedResponse([], { total_count: 0, total_pages: 0 });
  };

  const mockClient = {
    listSessions,
    deleteSession: async () => {},
  };

  const origGetClient = useInstancesStore.getState().getClient;
  useInstancesStore.setState({
    instances: [
      {
        id: "inst-1",
        name: "mock",
        baseUrl: "http://x",
        lastProbeAt: Date.now(),
        agents: [],
        lastInfo: null,
        agentsFetchedAt: 0,
      } as any,
    ],
    activeInstanceId: "inst-1",
    getClient: ((id: string) =>
      id === "inst-1" ? (mockClient as any) : null) as any,
  });

  return {
    instanceId: "inst-1",
    listSessions,
    restore: () => {
      useInstancesStore.setState({
        instances: [],
        activeInstanceId: null,
        getClient: origGetClient,
      });
    },
  };
}

function resetSessionsStore() {
  useSessionsStore.setState({
    byInstance: {},
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
    const ctx = setupMockInstance({
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
        .loadSessions(ctx.instanceId);
      eq(list.length, 15, "首次返回 15 条");
      const pg = useSessionsStore.getState().pagination[ctx.instanceId];
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
    const ctx = setupMockInstance({
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
      await useSessionsStore.getState().loadSessions(ctx.instanceId);
      await useSessionsStore.getState().loadMoreSessions(ctx.instanceId);
      const list = useSessionsStore.getState().byInstance[ctx.instanceId];
      eq(list.length, 30, "page1 + page2 = 30 条");
      const pg = useSessionsStore.getState().pagination[ctx.instanceId];
      eq(pg?.page, 2, "page = 2");
      eq(pg?.hasMore, true, "还有 page 3 → hasMore = true");

      await useSessionsStore.getState().loadMoreSessions(ctx.instanceId);
      const list2 = useSessionsStore.getState().byInstance[ctx.instanceId];
      eq(list2.length, 42, "page1+2+3 = 42 条");
      const pg2 = useSessionsStore.getState().pagination[ctx.instanceId];
      eq(pg2?.page, 3, "page = 3");
      eq(pg2?.hasMore, false, "已是最后一页 → hasMore = false");
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== hasMore=false 时 loadMore no-op ===");
  {
    resetSessionsStore();
    const ctx = setupMockInstance({
      responses: {
        1: makePaginatedResponse(
          Array.from({ length: 5 }, (_, i) => `s-${i + 1}`),
          { total_count: 5, total_pages: 1 }
        ),
      },
    });
    try {
      await useSessionsStore.getState().loadSessions(ctx.instanceId);
      const before = useSessionsStore.getState().byInstance[ctx.instanceId]
        .length;
      await useSessionsStore.getState().loadMoreSessions(ctx.instanceId);
      const after = useSessionsStore.getState().byInstance[ctx.instanceId]
        .length;
      eq(after, before, "hasMore=false 时不追加");
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== loadMore 并发点击下只触发一次 ===");
  {
    resetSessionsStore();
    let page2Calls = 0;
    const ctx = setupMockInstance({
      responses: {
        1: makePaginatedResponse(
          Array.from({ length: 15 }, (_, i) => `s-${i + 1}`),
          { total_count: 30, total_pages: 2 }
        ),
      },
    });
    const origClient = (useInstancesStore.getState().getClient as any)(
      ctx.instanceId
    );
    origClient.listSessions = async (params: any) => {
      if (params?.page === 2) {
        page2Calls++;
        // 模拟慢请求，确保 3 个并发调用能进入同一个 loadingMore 锁
        await new Promise((r) => setTimeout(r, 20));
        return makePaginatedResponse(
          Array.from({ length: 15 }, (_, i) => `s-${i + 16}`),
          { total_count: 30, total_pages: 2 }
        );
      }
      return ctx.listSessions(params);
    };
    try {
      await useSessionsStore.getState().loadSessions(ctx.instanceId);
      // 并发触发 3 次 loadMore
      await Promise.all([
        useSessionsStore.getState().loadMoreSessions(ctx.instanceId),
        useSessionsStore.getState().loadMoreSessions(ctx.instanceId),
        useSessionsStore.getState().loadMoreSessions(ctx.instanceId),
      ]);
      eq(page2Calls, 1, "page=2 只调用一次（loadingMore 锁）");
      const list = useSessionsStore.getState().byInstance[ctx.instanceId];
      eq(list.length, 30, "最终 30 条（没有重复追加）");
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== session_id 重复时去重 ===");
  {
    resetSessionsStore();
    const ctx = setupMockInstance({
      responses: {
        1: makePaginatedResponse(
          Array.from({ length: 15 }, (_, i) => `s-${i + 1}`),
          { total_count: 30, total_pages: 2 }
        ),
        2: makePaginatedResponse(
          // page2 重复了 page1 的最后 5 条（模拟 AGNO 偶发重复）
          [
            ...Array.from({ length: 5 }, (_, i) => `s-${i + 11}`),
            ...Array.from({ length: 10 }, (_, i) => `s-${i + 16}`),
          ],
          { total_count: 30, total_pages: 2 }
        ),
      },
    });
    try {
      await useSessionsStore.getState().loadSessions(ctx.instanceId);
      await useSessionsStore.getState().loadMoreSessions(ctx.instanceId);
      const list = useSessionsStore.getState().byInstance[ctx.instanceId];
      eq(list.length, 25, "重复的 session_id 被去重");
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== removeSession 同步 totalCount ===");
  {
    resetSessionsStore();
    const ctx = setupMockInstance({
      responses: {
        1: makePaginatedResponse(
          Array.from({ length: 15 }, (_, i) => `s-${i + 1}`),
          { total_count: 42, total_pages: 3 }
        ),
      },
    });
    try {
      await useSessionsStore.getState().loadSessions(ctx.instanceId);
      await useSessionsStore
        .getState()
        .removeSession(ctx.instanceId, "s-1");
      const pg = useSessionsStore.getState().pagination[ctx.instanceId];
      eq(pg?.totalCount, 41, "删除一条后 totalCount -1");
      const list = useSessionsStore.getState().byInstance[ctx.instanceId];
      eq(list.length, 14, "列表同步 -1");
      assert(!list.find((s) => s.session_id === "s-1"), "s-1 已被移除");
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== total_count 缺失时从 list.length 兜底 ===");
  {
    resetSessionsStore();
    const ctx = setupMockInstance({
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
      await useSessionsStore.getState().loadSessions(ctx.instanceId);
      const pg = useSessionsStore.getState().pagination[ctx.instanceId];
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
    const ctx = setupMockInstance({
      responses: {
        1: makePaginatedResponse(
          Array.from({ length: 15 }, (_, i) => `s-${i + 1}`),
          { total_count: 15, total_pages: 1 }
        ),
      },
    });
    const origClient = (useInstancesStore.getState().getClient as any)(
      ctx.instanceId
    );
    origClient.listSessions = async (params: any) => {
      callCount++;
      return ctx.listSessions(params);
    };
    try {
      await useSessionsStore.getState().loadSessions(ctx.instanceId);
      await useSessionsStore.getState().loadSessions(ctx.instanceId);
      eq(callCount, 1, "第二次 loadSessions 没触发新请求（缓存命中）");
      // force=true 会重新拉
      await useSessionsStore.getState().loadSessions(ctx.instanceId, true);
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
//  user_id 过滤（per-instance userId 隔离）
// ────────────────────────────────────────────────────────────────

async function userIdTests(): Promise<void> {
  console.log("\n=== loadSessions 把 instance.userId 透传给 listSessions ===");
  {
    resetSessionsStore();
    let lastParams: any = null;
    const ctx = setupMockInstance({
      responses: {
        1: {
          data: [makeSession("s-1"), makeSession("s-2")],
          meta: { limit: 15, page: 1, total_count: 2, total_pages: 1 },
        },
      },
    });
    // 给 instance 加 userId
    useInstancesStore.setState((s) => ({
      instances: s.instances.map((i) =>
        i.id === ctx.instanceId ? { ...i, userId: "mike" } : i
      ),
    }));
    const origClient = (useInstancesStore.getState().getClient as any)(
      ctx.instanceId
    );
    origClient.listSessions = async (params: any) => {
      lastParams = params;
      return ctx.listSessions(params);
    };
    try {
      await useSessionsStore.getState().loadSessions(ctx.instanceId);
      eq(lastParams?.user_id, "mike", "listSessions 收到 user_id='mike'");
      eq(
        useSessionsStore.getState().sessionsUserId[ctx.instanceId],
        "mike",
        "sessionsUserId 记录 mike"
      );
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== instance.userId 为空时不传 user_id ===");
  {
    resetSessionsStore();
    let lastParams: any = null;
    const ctx = setupMockInstance({
      responses: {
        1: {
          data: [makeSession("s-1")],
          meta: { limit: 15, page: 1, total_count: 1, total_pages: 1 },
        },
      },
    });
    const origClient = (useInstancesStore.getState().getClient as any)(
      ctx.instanceId
    );
    origClient.listSessions = async (params: any) => {
      lastParams = params;
      return ctx.listSessions(params);
    };
    try {
      await useSessionsStore.getState().loadSessions(ctx.instanceId);
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
    const ctx = setupMockInstance({});
    // 服务端不严格按 user_id 过滤，返回了别人的 session
    useInstancesStore.setState((s) => ({
      instances: s.instances.map((i) =>
        i.id === ctx.instanceId ? { ...i, userId: "mike" } : i
      ),
    }));
    const origClient = (useInstancesStore.getState().getClient as any)(
      ctx.instanceId
    );
    origClient.listSessions = async () => ({
      data: [
        { ...makeSession("s-mike-1"), user_id: "mike" },
        { ...makeSession("s-alice-1"), user_id: "alice" },
        { ...makeSession("s-no-uid"), user_id: undefined },
      ],
      meta: { limit: 15, page: 1, total_count: 3, total_pages: 1 },
    });
    try {
      const list = await useSessionsStore.getState().loadSessions(ctx.instanceId);
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
      const pg = useSessionsStore.getState().pagination[ctx.instanceId];
      // totalCount 信任服务端 meta（即便服务端"未严格过滤"给了 total_count=3，
      // 我们也按 meta 走；翻完所有页后 hasMore 自然变 false，靠 client filter 隔离显示）。
      eq(pg?.totalCount, 3, "totalCount 来自 meta.total_count");
    } finally {
      ctx.restore();
    }
  }

  console.log("\n=== 改 instance.userId → 下次 loadSessions 强制重拉 ===");
  {
    resetSessionsStore();
    let callCount = 0;
    const ctx = setupMockInstance({
      responses: {
        1: {
          data: [makeSession("s-1")],
          meta: { limit: 15, page: 1, total_count: 1, total_pages: 1 },
        },
      },
    });
    useInstancesStore.setState((s) => ({
      instances: s.instances.map((i) =>
        i.id === ctx.instanceId ? { ...i, userId: "mike" } : i
      ),
    }));
    const origClient = (useInstancesStore.getState().getClient as any)(
      ctx.instanceId
    );
    origClient.listSessions = async (params: any) => {
      callCount++;
      return ctx.listSessions(params);
    };
    try {
      await useSessionsStore.getState().loadSessions(ctx.instanceId);
      eq(callCount, 1, "首次拉 1 次");
      await useSessionsStore.getState().loadSessions(ctx.instanceId);
      eq(callCount, 1, "userId 未变 + 有缓存 → 不重拉");

      // 改 userId
      useInstancesStore.setState((s) => ({
        instances: s.instances.map((i) =>
          i.id === ctx.instanceId ? { ...i, userId: "alice" } : i
        ),
      }));
      await useSessionsStore.getState().loadSessions(ctx.instanceId);
      eq(callCount, 2, "userId 变了 → 强制重拉");
      eq(
        useSessionsStore.getState().sessionsUserId[ctx.instanceId],
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
    const ctx = setupMockInstance({
      responses: {
        1: makePaginatedResponse(
          Array.from({ length: 15 }, (_, i) => `s-${i + 1}`),
          { total_count: 30, total_pages: 2 }
        ),
        2: makePaginatedResponse(
          Array.from({ length: 15 }, (_, i) => `s-${i + 16}`),
          { total_count: 30, total_pages: 2 }
        ),
      },
    });
    useInstancesStore.setState((s) => ({
      instances: s.instances.map((i) =>
        i.id === ctx.instanceId ? { ...i, userId: "mike" } : i
      ),
    }));
    const origClient = (useInstancesStore.getState().getClient as any)(
      ctx.instanceId
    );
    origClient.listSessions = async (params: any) => {
      seenParams.push(params);
      return ctx.listSessions(params);
    };
    try {
      await useSessionsStore.getState().loadSessions(ctx.instanceId);
      await useSessionsStore.getState().loadMoreSessions(ctx.instanceId);
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
    const ctx = setupMockInstance({
      responses: {
        1: makePaginatedResponse(
          Array.from({ length: 5 }, (_, i) => `s-${i + 1}`),
          { total_count: 5, total_pages: 1 }
        ),
      },
    });
    try {
      await useSessionsStore.getState().loadSessions(ctx.instanceId);
      assert(
        useSessionsStore.getState().byInstance[ctx.instanceId]?.length === 5,
        "缓存有 5 条"
      );
      useSessionsStore.getState().clearSessionsCache(ctx.instanceId);
      assert(
        !useSessionsStore.getState().byInstance[ctx.instanceId],
        "byInstance 清掉"
      );
      assert(
        !useSessionsStore.getState().pagination[ctx.instanceId],
        "pagination 清掉"
      );
      assert(
        !useSessionsStore.getState().sessionsUserId[ctx.instanceId],
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
