/**
 * Instances store: 多 AGNO 实例管理
 * - 实例列表持久化到 localStorage
 * - 当前激活实例 id
 * - 当前实例的 client 实例（按 baseUrl + token 缓存）
 */

import { create } from "zustand";
import { AgnoClient } from "@/lib/agno-client";
import type { AgAgentResponse, AgInfoResponse } from "@/lib/agno-types";
import { loadJSON, saveJSON } from "@/lib/storage";
import { generateId } from "@/lib/utils";

export interface AgnoInstance {
  id: string;
  name: string;
  baseUrl: string;
  token?: string | null;
  description?: string;
  /** 探活后缓存 */
  lastInfo?: AgInfoResponse | null;
  lastProbeAt?: number;
  /** agent 缓存（按 instance 缓存） */
  agents?: AgAgentResponse[];
  agentsFetchedAt?: number;
  /** 上次拉取 agents 失败的错误信息 */
  lastAgentsError?: string | null;
}

const STORAGE_KEY = "agno-v2:instances";
const ACTIVE_KEY = "agno-v2:active-instance";

interface InstancesState {
  instances: AgnoInstance[];
  activeInstanceId: string | null;
  /** 实例 → AgnoClient 缓存（内存） */
  clients: Record<string, AgnoClient>;
  /** 正在加载 agents 的 instanceId（防并发） */
  loadingAgents: Record<string, boolean>;

  addInstance: (data: Omit<AgnoInstance, "id">) => AgnoInstance;
  updateInstance: (id: string, patch: Partial<AgnoInstance>) => void;
  removeInstance: (id: string) => void;
  setActiveInstance: (id: string | null) => void;
  probeInstance: (id: string) => Promise<AgInfoResponse | null>;
  loadAgents: (id: string, force?: boolean) => Promise<AgAgentResponse[]>;
  getClient: (id: string) => AgnoClient | null;
  getActiveClient: () => AgnoClient | null;
}

function loadInstances(): AgnoInstance[] {
  return loadJSON<AgnoInstance[]>(STORAGE_KEY, []);
}

/**
 * 把 fetch 失败信息转成用户可读的提示
 * - CORS: 建议使用 /api 代理
 * - 404: 路径不对
 * - 5xx: 服务端错误
 * - network: 网络断开
 */
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

function loadActive(): string | null {
  return loadJSON<string | null>(ACTIVE_KEY, null);
}

export const useInstancesStore = create<InstancesState>((set, get) => ({
  instances: loadInstances(),
  activeInstanceId: loadActive(),
  clients: {},
  loadingAgents: {},

  addInstance: (data) => {
    const instance: AgnoInstance = {
      id: generateId(),
      ...data,
    };
    set((s) => {
      const next = [...s.instances, instance];
      saveJSON(STORAGE_KEY, next);
      return { instances: next };
    });
    return instance;
  },

  updateInstance: (id, patch) => {
    set((s) => {
      const next = s.instances.map((i) =>
        i.id === id ? { ...i, ...patch } : i
      );
      saveJSON(STORAGE_KEY, next);
      // token 变更时清掉 client 缓存
      const clients = { ...s.clients };
      if (patch.token !== undefined || patch.baseUrl !== undefined) {
        delete clients[id];
        // baseUrl 变更时同时清掉 agents 缓存（强制重拉）
        if (patch.baseUrl !== undefined) {
          next.forEach((inst) => {
            if (inst.id === id) {
              inst.agents = undefined;
              inst.agentsFetchedAt = undefined;
            }
          });
        }
      }
      return { instances: next, clients };
    });
  },

  removeInstance: (id) => {
    set((s) => {
      const next = s.instances.filter((i) => i.id !== id);
      saveJSON(STORAGE_KEY, next);
      const { [id]: _, ...clients } = s.clients;
      const wasActive = s.activeInstanceId === id;
      const newActive = wasActive ? null : s.activeInstanceId;
      if (wasActive) saveJSON(ACTIVE_KEY, null);
      return { instances: next, clients, activeInstanceId: newActive };
    });
  },

  setActiveInstance: (id) => {
    saveJSON(ACTIVE_KEY, id);
    set({ activeInstanceId: id });
  },

  probeInstance: async (id) => {
    const inst = get().instances.find((i) => i.id === id);
    if (!inst) return null;
    const client = new AgnoClient({
      baseUrl: inst.baseUrl,
      token: inst.token,
    });
    try {
      const info = await client.info();
      get().updateInstance(id, { lastInfo: info, lastProbeAt: Date.now() });
      return info;
    } catch (err) {
      const info: AgInfoResponse = {
        agent_count: 0,
        team_count: 0,
        workflow_count: 0,
      };
      get().updateInstance(id, {
        lastInfo: { ...info, _error: String(err) } as any,
        lastProbeAt: Date.now(),
      });
      return null;
    }
  },

  loadAgents: async (id, force = false) => {
    const inst = get().instances.find((i) => i.id === id);
    if (!inst) return [];

    // 防并发：已经在加载中
    if (get().loadingAgents[id]) {
      return inst.agents ?? [];
    }

    // 没过期就直接返回
    const stale =
      !inst.agentsFetchedAt || Date.now() - inst.agentsFetchedAt > 60_000;
    if (!force && !stale && inst.agents) {
      return inst.agents;
    }

    set((s) => ({ loadingAgents: { ...s.loadingAgents, [id]: true } }));

    try {
      const client = get().getClient(id) ?? new AgnoClient({
        baseUrl: inst.baseUrl,
        token: inst.token,
      });
      const agents = await client.listAgents();
      get().updateInstance(id, {
        agents,
        agentsFetchedAt: Date.now(),
        lastAgentsError: null,
      });
      return agents;
    } catch (err: any) {
      console.error("Failed to load agents", err);
      const rawMsg = err?.message ?? String(err);
      const friendly = formatLoadError(rawMsg, inst.baseUrl);
      get().updateInstance(id, {
        agents: [],
        lastAgentsError: friendly,
      });
      return [];
    } finally {
      set((s) => {
        const { [id]: _, ...rest } = s.loadingAgents;
        return { loadingAgents: rest };
      });
    }
  },

  getClient: (id) => {
    const inst = get().instances.find((i) => i.id === id);
    if (!inst) return null;
    const existing = get().clients[id];
    if (existing) return existing;
    const client = new AgnoClient({
      baseUrl: inst.baseUrl,
      token: inst.token,
    });
    set((s) => ({ clients: { ...s.clients, [id]: client } }));
    return client;
  },

  getActiveClient: () => {
    const id = get().activeInstanceId;
    if (!id) return null;
    return get().getClient(id);
  },
}));

export function useActiveInstance() {
  return useInstancesStore((s) => {
    if (!s.activeInstanceId) return null;
    return s.instances.find((i) => i.id === s.activeInstanceId) ?? null;
  });
}

const EMPTY_AGENTS: any[] = [];

/**
 * 合并到单次订阅：避免闭包陷阱
 * 内部直接用 s.activeInstanceId，确保两个字段都订阅
 */
export function useActiveAgents(): AgAgentResponse[] {
  return useInstancesStore((s) => {
    if (!s.activeInstanceId) return EMPTY_AGENTS;
    return (
      s.instances.find((i) => i.id === s.activeInstanceId)?.agents ??
      EMPTY_AGENTS
    );
  });
}

/** 当前实例是否正在加载 agents */
export function useIsLoadingAgents() {
  return useInstancesStore((s) => {
    if (!s.activeInstanceId) return false;
    return !!s.loadingAgents[s.activeInstanceId];
  });
}