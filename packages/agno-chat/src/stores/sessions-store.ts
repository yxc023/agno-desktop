/**
 * Sessions store: 当前 agent 的 session 列表 + 当前选中的 session
 *
 * 设计：
 * - byAgent: { [agentId]: AgSessionSummary[] } —— 按 agentId 索引，不再按 instanceId。
 *   一个 AGNO 实例可能有多个 agent；session 列表天然属于某个 agent，
 *   切换 agent 时是另一份列表，不该混着缓存。
 * - 注入式 context：`_client` / `_agentId` / `_userId` 由 <ChatPanel> 在 mount 时
 *   调 `setContext` 注入。store 不再直接依赖 useInstancesStore。
 *
 * Pagination：
 * - 默认拉 15 条（`/sessions?limit=15`），不是 100——`/sessions` 接口在某些
 *   AGNO 版本上很慢，15 条足够 sidebar 起步展示，更多让用户主动点"加载更多"。
 * - 每个 agent 独立的 pagination 状态：page / limit / totalCount / hasMore。
 * - `loadMoreSessions(agentId)` 拉下一页并 append 到现有 list（按 session_id
 *   去重，避免 AGNO 在 page boundary 偶发的重复返回）。
 *
 * session 的消息内容存在 chat-store 里。
 *
 * user_id 隔离：
 * - 每个 agent 一个 userId（来自调用方注入的 `_userId`，通常取自 instance.userId）。
 * - `loadSessions` / `loadMoreSessions` 把 `_userId` 作为 `user_id` query 透传给
 *   AGNO `GET /sessions?user_id=...`——服务端按用户隔离 session。
 * - 客户端再做一次 defensive 过滤：服务端不严格过滤时仍兜底只显示当前 userId。
 * - 缓存键隐含 userId：`sessionsUserId[agentId]` 记录上次 fetch 的 userId，
 *   userId 一变就强制重拉，避免旧数据混入新身份。
 */

import { create } from "zustand";
import type { AgSessionSummary } from "../lib/agno-types";
import type { AgnoClient } from "../lib/agno-client";

const DEFAULT_PAGE_LIMIT = 15;

interface PaginationState {
  page: number;
  limit: number;
  totalCount: number;
  hasMore: boolean;
}

/**
 * 客户端 defensive 过滤：保留 user_id 与当前 userId 匹配（或 server 没回 user_id）的 session。
 * 服务端过滤为主（`/sessions?user_id=...`），这条只是兜底——有些 AGNO 版本不严格
 * 按 user_id 过滤，返回全量 session 时仍能隔离。
 */
function filterByUserId(
  list: AgSessionSummary[],
  expectedUserId: string
): AgSessionSummary[] {
  if (!expectedUserId) return list;
  return list.filter((s) => !s.user_id || s.user_id === expectedUserId);
}

interface SessionsState {
  byAgent: Record<string, AgSessionSummary[]>;
  /**
   * 每个 agent 的 pagination 状态。key = agentId。
   * 用 `Record` 而不是嵌套 map，方便 React 选择器按 agentId O(1) 读。
   */
  pagination: Record<string, PaginationState>;
  /**
   * 上次 fetch 该 agent sessions 时使用的 userId。
   * userId 改变时（调用方更新了 instance.userId 并 setContext 注入新的），
   * 下次 loadSessions 检测到不匹配就 force reload——不需要调用方显式 invalidate。
   * 空串表示"未传 userId 过滤"。
   */
  sessionsUserId: Record<string, string>;
  currentSessionId: string | null;
  loading: boolean;
  /**
   * "加载更多"专属 loading flag —— 和 `loading` 区分开，避免初始 fetch 的
   * skeleton 和翻页时的 inline spinner 互相干扰。
   */
  loadingMore: boolean;
  searchQuery: string;
  loadError: Record<string, string | null>;

  /**
   * Injected AGNO client. Set at <ChatPanel> mount, cleared at unmount.
   * Replaces the previous useInstancesStore.getState().getClient(instanceId) pattern
   * that coupled the store to app-specific instance management.
   */
  _client: AgnoClient | null;
  /**
   * Injected active agent ID. Replaces useInstancesStore.getState().activeInstanceId.
   * loadSessions / upsertSession / removeSession / renameSession / clearSessionsCache
   * all key by this agentId (not by instanceId).
   */
  _agentId: string | null;
  /**
   * Injected user ID for the current session. Comes from the active AGNO instance's
   * userId. Used by loadSessions when calling AGNO's session-scoped APIs.
   */
  _userId: string;
  setContext: (ctx: { client: AgnoClient; agentId: string; userId?: string }) => void;
  clearContext: () => void;

  loadSessions: (agentId: string, force?: boolean) => Promise<AgSessionSummary[]>;
  loadMoreSessions: (agentId: string) => Promise<void>;
  setCurrentSession: (id: string | null) => void;
  upsertSession: (agentId: string, session: AgSessionSummary) => void;
  removeSession: (agentId: string, sessionId: string) => Promise<void>;
  renameSession: (
    agentId: string,
    sessionId: string,
    name: string
  ) => Promise<void>;
  setSearchQuery: (q: string) => void;
  /**
   * 清掉某个 agent 的 sessions 缓存 + pagination。
   * 通常不需要手动调：sessionsUserId 自检已经覆盖；这里是逃生口。
   */
  clearSessionsCache: (agentId: string) => void;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  byAgent: {},
  pagination: {},
  sessionsUserId: {},
  currentSessionId: null,
  loading: false,
  loadingMore: false,
  searchQuery: "",
  loadError: {},

  _client: null,
  _agentId: null,
  _userId: "",

  setContext: (ctx) =>
    set({
      _client: ctx.client,
      _agentId: ctx.agentId,
      _userId: ctx.userId ?? "",
    }),

  clearContext: () =>
    set({ _client: null, _agentId: null, _userId: "" }),

  loadSessions: async (agentId, force = false) => {
    const client = get()._client;
    if (!client) return [];
    const currentUserId = get()._userId;
    const lastUserId = get().sessionsUserId[agentId] ?? "";
    const userIdChanged = lastUserId !== currentUserId;
    if (!force && !userIdChanged && get().byAgent[agentId]?.length) {
      return get().byAgent[agentId];
    }
    set({ loading: true });
    try {
      const res = await client.listSessions({
        limit: DEFAULT_PAGE_LIMIT,
        page: 1,
        user_id: currentUserId || undefined,
      });
      const filtered = filterByUserId(res.data ?? [], currentUserId);
      const meta = res.meta;
      const limit = meta?.limit ?? DEFAULT_PAGE_LIMIT;
      const totalCount = meta?.total_count ?? filtered.length;
      const totalPages =
        meta?.total_pages ??
        (totalCount > 0 ? Math.ceil(totalCount / limit) : 1);
      set((s) => ({
        byAgent: { ...s.byAgent, [agentId]: filtered },
        pagination: {
          ...s.pagination,
          [agentId]: {
            page: 1,
            limit,
            totalCount,
            hasMore: 1 < totalPages,
          },
        },
        sessionsUserId: { ...s.sessionsUserId, [agentId]: currentUserId },
        loadError: { ...s.loadError, [agentId]: null },
        loading: false,
      }));
      return filtered;
    } catch (err: any) {
      console.error("loadSessions failed", err);
      const rawMsg = err?.message ?? String(err);
      set((s) => ({
        loadError: { ...s.loadError, [agentId]: rawMsg },
        loading: false,
      }));
      return [];
    }
  },

  loadMoreSessions: async (agentId) => {
    const pg = get().pagination[agentId];
    if (!pg || !pg.hasMore || get().loadingMore || get().loading) return;
    const client = get()._client;
    if (!client) return;
    const currentUserId = get()._userId;
    const nextPage = pg.page + 1;
    set({ loadingMore: true });
    try {
      const res = await client.listSessions({
        limit: pg.limit,
        page: nextPage,
        user_id: currentUserId || undefined,
      });
      const filtered = filterByUserId(res.data ?? [], currentUserId);
      const meta = res.meta;
      const totalCount = meta?.total_count ?? filtered.length;
      const totalPages =
        meta?.total_pages ??
        (totalCount > 0 ? Math.ceil(totalCount / pg.limit) : nextPage);
      set((s) => {
        const existing = s.byAgent[agentId] ?? [];
        const seen = new Set(existing.map((x) => x.session_id));
        const additions = filtered.filter((x) => !seen.has(x.session_id));
        return {
          byAgent: {
            ...s.byAgent,
            [agentId]: [...existing, ...additions],
          },
          pagination: {
            ...s.pagination,
            [agentId]: {
              page: nextPage,
              limit: pg.limit,
              totalCount,
              hasMore: nextPage < totalPages,
            },
          },
          sessionsUserId: { ...s.sessionsUserId, [agentId]: currentUserId },
          loadingMore: false,
        };
      });
    } catch (err) {
      console.error("loadMoreSessions failed", err);
      set({ loadingMore: false });
    }
  },

  setCurrentSession: (id) => set({ currentSessionId: id }),

  upsertSession: (agentId, session) => {
    set((s) => {
      const list = s.byAgent[agentId] ?? [];
      const idx = list.findIndex((x) => x.session_id === session.session_id);
      let next: AgSessionSummary[];
      if (idx >= 0) {
        next = list.map((x, i) => (i === idx ? { ...x, ...session } : x));
      } else {
        next = [session, ...list];
      }
      return {
        byAgent: { ...s.byAgent, [agentId]: next },
      };
    });
  },

  removeSession: async (agentId, sessionId) => {
    const client = get()._client;
    if (!client) return;
    try {
      await client.deleteSession(sessionId);
    } catch (err) {
      console.error("deleteSession failed", err);
    }
    set((s) => {
      const list = (s.byAgent[agentId] ?? []).filter(
        (x) => x.session_id !== sessionId
      );
      const pg = s.pagination[agentId];
      const nextPagination = pg
        ? {
            ...s.pagination,
            [agentId]: {
              ...pg,
              totalCount: Math.max(0, pg.totalCount - 1),
            },
          }
        : s.pagination;
      return {
        byAgent: { ...s.byAgent, [agentId]: list },
        pagination: nextPagination,
        currentSessionId:
          s.currentSessionId === sessionId ? null : s.currentSessionId,
      };
    });
  },

  renameSession: async (agentId, sessionId, name) => {
    const client = get()._client;
    if (!client) return;
    try {
      const updated = await client.renameSession(sessionId, name);
      get().upsertSession(agentId, {
        ...updated,
        session_id: updated.session_id,
        session_name: updated.session_name,
        session_type: updated.session_type,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
      });
    } catch (err) {
      console.error("renameSession failed", err);
    }
  },

  setSearchQuery: (q) => set({ searchQuery: q }),

  clearSessionsCache: (agentId) => {
    set((s) => {
      const { [agentId]: _by, ...byRest } = s.byAgent;
      const { [agentId]: _pg, ...pgRest } = s.pagination;
      const { [agentId]: _su, ...suRest } = s.sessionsUserId;
      return {
        byAgent: byRest,
        pagination: pgRest,
        sessionsUserId: suRest,
      };
    });
  },
}));

const EMPTY_SESSIONS: AgSessionSummary[] = [];

export function useCurrentAgentSessions() {
  return useSessionsStore((s) => {
    if (!s._agentId) return EMPTY_SESSIONS;
    return s.byAgent[s._agentId] ?? EMPTY_SESSIONS;
  });
}