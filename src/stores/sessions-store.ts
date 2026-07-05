/**
 * Sessions store: 当前实例的 session 列表 + 当前选中的 session
 *
 * 缓存结构:
 * - byInstance: { [instanceId]: AgSessionSummary[] }
 * - currentSessionId: 当前活跃 session
 *
 * session 的消息内容存在 chat-store 里
 */

import { create } from "zustand";
import type { AgSessionSummary } from "@/lib/agno-types";
import { useInstancesStore } from "./instances-store";

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
  currentSessionId: string | null;
  loading: boolean;
  searchQuery: string;
  loadError: Record<string, string | null>;

  loadSessions: (instanceId: string, force?: boolean) => Promise<AgSessionSummary[]>;
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
  currentSessionId: null,
  loading: false,
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
      const res = await client.listSessions({ limit: 100 });
      const list = res.data ?? [];
      set((s) => ({
        byInstance: { ...s.byInstance, [instanceId]: list },
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
      return {
        byInstance: { ...s.byInstance, [instanceId]: list },
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