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

interface SessionsState {
  byInstance: Record<string, AgSessionSummary[]>;
  /**
   * 每个实例的 pagination 状态。key = instanceId。
   * 用 `Record` 而不是嵌套 map，方便 React 选择器按 instanceId O(1) 读。
   */
  pagination: Record<string, PaginationState>;
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
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  byInstance: {},
  pagination: {},
  currentSessionId: null,
  loading: false,
  loadingMore: false,
  searchQuery: "",
  loadError: {},

  loadSessions: async (instanceId, force = false) => {
    if (!force && get().byInstance[instanceId]?.length) {
      return get().byInstance[instanceId];
    }
    const client = useInstancesStore.getState().getClient(instanceId);
    if (!client) return [];
    set({ loading: true });
    try {
      const res = await client.listSessions({
        limit: DEFAULT_PAGE_LIMIT,
        page: 1,
      });
      const list = res.data ?? [];
      const meta = res.meta;
      const limit = meta?.limit ?? DEFAULT_PAGE_LIMIT;
      const totalCount = meta?.total_count ?? list.length;
      // total_pages 不一定有：自己从 total_count 算。优先用 API 给的（可能更准，
      // 比如 AGNO 在边界值上用 ceil / floor 偶尔不一致）。
      const totalPages =
        meta?.total_pages ??
        (totalCount > 0 ? Math.ceil(totalCount / limit) : 1);
      set((s) => ({
        byInstance: { ...s.byInstance, [instanceId]: list },
        pagination: {
          ...s.pagination,
          [instanceId]: {
            page: 1,
            limit,
            totalCount,
            hasMore: 1 < totalPages,
          },
        },
        loadError: { ...s.loadError, [instanceId]: null },
        loading: false,
      }));
      return list;
    } catch (err: any) {
      console.error("loadSessions failed", err);
      const rawMsg = err?.message ?? String(err);
      const inst = useInstancesStore
        .getState()
        .instances.find((i) => i.id === instanceId);
      const friendly = formatLoadError(rawMsg, inst?.baseUrl ?? "");
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
    const client = useInstancesStore.getState().getClient(instanceId);
    if (!client) return;
    const nextPage = pg.page + 1;
    set({ loadingMore: true });
    try {
      const res = await client.listSessions({
        limit: pg.limit,
        page: nextPage,
      });
      const more = res.data ?? [];
      const meta = res.meta;
      const totalCount = meta?.total_count ?? pg.totalCount;
      const totalPages =
        meta?.total_pages ??
        (totalCount > 0 ? Math.ceil(totalCount / pg.limit) : nextPage);
      set((s) => {
        const existing = s.byInstance[instanceId] ?? [];
        // 去重：AGNO 在 page 边界理论上不会重复，但万一有 race / 重复行
        // 不会让 sidebar 出现两条相同的 session。
        const seen = new Set(existing.map((x) => x.session_id));
        const additions = more.filter((x) => !seen.has(x.session_id));
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
}));

const EMPTY_SESSIONS: AgSessionSummary[] = [];

export function useCurrentInstanceSessions() {
  const activeId = useInstancesStore((s) => s.activeInstanceId);
  return useSessionsStore((s) => {
    if (!activeId) return EMPTY_SESSIONS;
    return s.byInstance[activeId] ?? EMPTY_SESSIONS;
  });
}