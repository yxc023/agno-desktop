/**
 * Sessions store: 当前实例的 session 列表 + 当前选中的 session
 *
 * 缓存结构:
 * - byInstance: { [instanceId]: AgSessionSummary[] }
 * - currentSessionId: 当前活跃 session
 *
 * Pagination：
 * - 默认拉 15 条（`/sessions?limit=15`），不是 100——`/sessions` 接口在某些
 *   AGNO 版本上很慢，15 条足够 sidebar 起步展示，更多让用户主动点"加载更多"。
 * - 每个实例独立的 pagination 状态：page / limit / totalCount / hasMore。
 * - `loadMoreSessions(instanceId)` 拉下一页并 append 到现有 list（按 session_id
 *   去重，避免 AGNO 在 page boundary 偶发的重复返回）。
 *
 * session 的消息内容存在 chat-store 里
 *
 * user_id 隔离：
 * - 每实例一个 userId（`AgnoInstance.userId`），不同实例可以不同身份
 * - `loadSessions` / `loadMoreSessions` 把 `inst.userId` 作为 `user_id` query 透传给
 *   AGNO `GET /sessions?user_id=...`——服务端按用户隔离 session
 * - 客户端再做一次 defensive 过滤：服务端不严格过滤时仍兜底只显示当前 userId
 * - 缓存键隐含 userId：`sessionsUserId[instanceId]` 记录上次 fetch 的 userId，
 *   实例的 userId 一变就强制重拉，避免旧数据混入新身份
 */

import { create } from "zustand";
import type { AgSessionSummary } from "@/lib/agno-types";
import { useInstancesStore } from "./instances-store";

/** 每次拉取的 session 数。sidebar 起步展示 15 条足够；想看更多点"加载更多"。 */
const DEFAULT_PAGE_LIMIT = 15;

/** 一个实例的 pagination 状态 */
interface PaginationState {
  page: number;
  limit: number;
  totalCount: number;
  hasMore: boolean;
}

function formatLoadError(rawMsg: string, baseUrl: string): string {
  const isCors =
    /Failed to fetch|NetworkError|CORS|Access-Control-Allow-Origin/i.test(
      rawMsg
    );
  if (isCors) {
    const isAbsolute = /^https?:\/\//i.test(baseUrl);
    if (isAbsolute) {
      return `CORS 拦截：浏览器不允许直接请求 ${baseUrl}。\n请把 baseUrl 改成 "/api"（用 Vite 代理绕过 CORS），或在后端配置 CORS。`;
    }
    return `CORS 拦截：${rawMsg}\n请检查后端 CORS 配置。`;
  }
  if (/404|Not Found/i.test(rawMsg)) {
    return `404 路径不存在。\n请确认 baseUrl 正确，例如 http://127.0.0.1:8000`;
  }
  if (/500|502|503|Internal Server/i.test(rawMsg)) {
    return `服务器错误：${rawMsg}\n请检查 AGNO 实例是否正常运行`;
  }
  return rawMsg;
}

/**
 * 客户端 defensive 过滤：保留 user_id 与当前实例匹配（或 server 没回 user_id）的 session。
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
  byInstance: Record<string, AgSessionSummary[]>;
  /**
   * 每个实例的 pagination 状态。key = instanceId。
   * 用 `Record` 而不是嵌套 map，方便 React 选择器按 instanceId O(1) 读。
   */
  pagination: Record<string, PaginationState>;
  /**
   * 上次 fetch 该实例 sessions 时使用的 userId。
   * 当 `instances.userId` 改变时（用户在 InstanceFormDialog 改 userId），
   * 下次 loadSessions 检测到不匹配就 force reload——不需要调用方显式 invalidate。
   * 空串表示"未传 userId 过滤"（实例当时没有 userId）。
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

  loadSessions: (instanceId: string, force?: boolean) => Promise<AgSessionSummary[]>;
  /** 拉下一页并 append。已无更多页时 no-op。 */
  loadMoreSessions: (instanceId: string) => Promise<void>;
  setCurrentSession: (id: string | null) => void;
  upsertSession: (instanceId: string, session: AgSessionSummary) => void;
  removeSession: (instanceId: string, sessionId: string) => Promise<void>;
  renameSession: (
    instanceId: string,
    sessionId: string,
    name: string
  ) => Promise<void>;
  setSearchQuery: (q: string) => void;
  filterForCurrentInstance: () => AgSessionSummary[];
  /**
   * 清掉某个实例的 sessions 缓存 + pagination。
   * InstanceFormDialog 在更新 userId 后调一下——下个 loadSessions 会重拉。
   * 通常不需要手动调：sessionsUserId 自检已经覆盖；这里是逃生口。
   */
  clearSessionsCache: (instanceId: string) => void;
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  byInstance: {},
  pagination: {},
  sessionsUserId: {},
  currentSessionId: null,
  loading: false,
  loadingMore: false,
  searchQuery: "",
  loadError: {},

  loadSessions: async (instanceId, force = false) => {
    const inst = useInstancesStore.getState().instances.find((i) => i.id === instanceId);
    const currentUserId = inst?.userId?.trim() ?? "";
    const lastUserId = get().sessionsUserId[instanceId] ?? "";
    // userId 变了 → 缓存已属于另一个身份，必须重拉
    const userIdChanged = lastUserId !== currentUserId;
    if (!force && !userIdChanged && get().byInstance[instanceId]?.length) {
      return get().byInstance[instanceId];
    }
    const client = useInstancesStore.getState().getClient(instanceId);
    if (!client) return [];
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
      // totalCount 信任服务端 meta（AGNO 在严格过滤时给的 total_count 就是我们的总数）。
      // 兜底用本页条数。注意：服务端不严格按 user_id 过滤时，total_count 可能含
      // 其他用户的 session——这种情况靠 `byInstance` 的 client filter 隔离显示，
      // pagination 多翻几页最终会拿完，hasMore 自然变 false。
      const totalCount = meta?.total_count ?? filtered.length;
      // total_pages 不一定有：自己从 total_count 算。优先用 API 给的（可能更准，
      // 比如 AGNO 在边界值上用 ceil / floor 偶尔不一致）。
      const totalPages =
        meta?.total_pages ??
        (totalCount > 0 ? Math.ceil(totalCount / limit) : 1);
      set((s) => ({
        byInstance: { ...s.byInstance, [instanceId]: filtered },
        pagination: {
          ...s.pagination,
          [instanceId]: {
            page: 1,
            limit,
            totalCount,
            hasMore: 1 < totalPages,
          },
        },
        sessionsUserId: { ...s.sessionsUserId, [instanceId]: currentUserId },
        loadError: { ...s.loadError, [instanceId]: null },
        loading: false,
      }));
      return filtered;
    } catch (err: any) {
      console.error("loadSessions failed", err);
      const rawMsg = err?.message ?? String(err);
      const instBase = inst?.baseUrl ?? "";
      const friendly = formatLoadError(rawMsg, instBase);
      set((s) => ({
        loadError: { ...s.loadError, [instanceId]: friendly },
        loading: false,
      }));
      return [];
    }
  },

  loadMoreSessions: async (instanceId) => {
    const pg = get().pagination[instanceId];
    // 已无更多 / 没有 pagination 状态 / 正在翻页 → no-op
    if (!pg || !pg.hasMore || get().loadingMore || get().loading) return;
    const inst = useInstancesStore.getState().instances.find((i) => i.id === instanceId);
    const currentUserId = inst?.userId?.trim() ?? "";
    const client = useInstancesStore.getState().getClient(instanceId);
    if (!client) return;
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
        const existing = s.byInstance[instanceId] ?? [];
        // 去重：AGNO 在 page 边界理论上不会重复，但万一有 race / 重复行
        // 不会让 sidebar 出现两条相同的 session。
        const seen = new Set(existing.map((x) => x.session_id));
        const additions = filtered.filter((x) => !seen.has(x.session_id));
        return {
          byInstance: {
            ...s.byInstance,
            [instanceId]: [...existing, ...additions],
          },
          pagination: {
            ...s.pagination,
            [instanceId]: {
              page: nextPage,
              limit: pg.limit,
              totalCount,
              hasMore: nextPage < totalPages,
            },
          },
          sessionsUserId: { ...s.sessionsUserId, [instanceId]: currentUserId },
          loadingMore: false,
        };
      });
    } catch (err) {
      console.error("loadMoreSessions failed", err);
      // 失败就停在这一页 —— hasMore 不动，让用户重试或者无视。
      // 不弹错误 toast，避免一个慢接口打断用户整个工作流。
      set({ loadingMore: false });
    }
  },

  setCurrentSession: (id) => set({ currentSessionId: id }),

  upsertSession: (instanceId, session) => {
    set((s) => {
      const list = s.byInstance[instanceId] ?? [];
      const idx = list.findIndex((x) => x.session_id === session.session_id);
      let next: AgSessionSummary[];
      if (idx >= 0) {
        next = list.map((x, i) => (i === idx ? { ...x, ...session } : x));
      } else {
        next = [session, ...list];
      }
      return {
        byInstance: { ...s.byInstance, [instanceId]: next },
      };
    });
  },

  removeSession: async (instanceId, sessionId) => {
    const client = useInstancesStore.getState().getClient(instanceId);
    if (!client) return;
    try {
      await client.deleteSession(sessionId);
    } catch (err) {
      console.error("deleteSession failed", err);
    }
    set((s) => {
      const list = (s.byInstance[instanceId] ?? []).filter(
        (x) => x.session_id !== sessionId
      );
      // totalCount 同步减 1，避免"加载更多"按钮还显示有 N 条未读
      const pg = s.pagination[instanceId];
      const nextPagination = pg
        ? {
            ...s.pagination,
            [instanceId]: {
              ...pg,
              totalCount: Math.max(0, pg.totalCount - 1),
            },
          }
        : s.pagination;
      return {
        byInstance: { ...s.byInstance, [instanceId]: list },
        pagination: nextPagination,
        currentSessionId:
          s.currentSessionId === sessionId ? null : s.currentSessionId,
      };
    });
  },

  renameSession: async (instanceId, sessionId, name) => {
    const client = useInstancesStore.getState().getClient(instanceId);
    if (!client) return;
    try {
      const updated = await client.renameSession(sessionId, name);
      get().upsertSession(instanceId, {
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

  filterForCurrentInstance: () => {
    const activeId = useInstancesStore.getState().activeInstanceId;
    if (!activeId) return [];
    const list = get().byInstance[activeId] ?? [];
    const q = get().searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((s) =>
      [
        s.session_name,
        s.session_id,
        s.session_summary,
        s.last_message_preview,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  },

  clearSessionsCache: (instanceId) => {
    set((s) => {
      const { [instanceId]: _by, ...byRest } = s.byInstance;
      const { [instanceId]: _pg, ...pgRest } = s.pagination;
      const { [instanceId]: _su, ...suRest } = s.sessionsUserId;
      return {
        byInstance: byRest,
        pagination: pgRest,
        sessionsUserId: suRest,
      };
    });
  },
}));

const EMPTY_SESSIONS: AgSessionSummary[] = [];

export function useCurrentInstanceSessions() {
  const activeId = useInstancesStore((s) => s.activeInstanceId);
  return useSessionsStore((s) => {
    if (!activeId) return EMPTY_SESSIONS;
    return s.byInstance[activeId] ?? EMPTY_SESSIONS;
  });
}