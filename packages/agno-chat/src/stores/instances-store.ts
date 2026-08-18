/**
 * Instances store: AGNO 实例管理
 *
 * 包级别的实例 store，提供 useActiveInstance / useActiveAgents 等 hook。
 * 应用的 <ChatPanel> 在 mount 时通过 setContext 注入当前实例的 baseUrl / userId 等。
 * 实例的 CRUD 和应用侧的 UI 绑定由 app 层管理，包内只维护当前激活的实例引用。
 *
 * 使用方式：
 *   1. 在应用层 import { setContext, useActiveInstance, ... } from "agno-chat/stores/instances-store"
 *   2. 在 ChatPanel 里调 setContext({ baseUrl: ..., userId: ... })
 *   3. 子组件通过 useActiveInstance() 拿到当前实例信息
 *   4. 实例的 probe / agent 加载等操作通过 injected client 完成
 */

import { create } from "zustand";
import type { AgAgentResponse, AgInfoResponse } from "../lib/agno-types";

/** 当前活动的实例上下文 */
export interface ActiveInstance {
  id: string;
  name: string;
  baseUrl: string;
  userId: string;
  /** 探活 / agent 列表加载错误 */
  lastProbeAt: number | null;
  lastProbeError: string | null;
  lastAgentsError: string | null;
  /** 探活结果 */
  lastInfo: AgInfoResponse | null;
}

interface InstancesState {
  active: ActiveInstance | null;
  agents: AgAgentResponse[];
  loadingAgents: boolean;

  setContext: (ctx: Partial<ActiveInstance>) => void;
  clearContext: () => void;
  setAgents: (agents: AgAgentResponse[]) => void;
  setLoadingAgents: (loading: boolean) => void;
  setProbeError: (error: string | null) => void;
  setAgentsError: (error: string | null) => void;
  /** 由上层注入的 probeInstance / loadAgents / updateInstance 实现 */
  probeInstance: (id: string) => Promise<void>;
  loadAgents: (id: string, force?: boolean) => Promise<void>;
  updateInstance: (id: string, patch: Partial<ActiveInstance>) => void;
}

export const useInstancesStore = create<InstancesState>((set) => ({
  active: null,
  agents: [],
  loadingAgents: false,

  setContext: (ctx) =>
    set((s) => ({
      active: s.active ? { ...s.active, ...ctx } : ({ id: "", name: "", baseUrl: "", userId: "", lastProbeAt: null, lastProbeError: null, lastAgentsError: null, lastInfo: null, ...ctx } as ActiveInstance),
    })),

  clearContext: () => set({ active: null, agents: [], loadingAgents: false }),

  setAgents: (agents) => set({ agents }),

  setLoadingAgents: (loadingAgents) => set({ loadingAgents }),

  setProbeError: (error) =>
    set((s) => ({
      active: s.active ? { ...s.active, lastProbeError: error } : null,
    })),

  setAgentsError: (error) =>
    set((s) => ({
      active: s.active ? { ...s.active, lastAgentsError: error } : null,
    })),

  probeInstance: async (_id: string) => {
    // stub — 由上层通过 setContext 覆盖
  },

  loadAgents: async (_id: string, _force?: boolean) => {
    // stub — 由上层通过 setContext 覆盖
  },

  updateInstance: (_id: string, _patch: Partial<ActiveInstance>) => {
    // stub — 由上层通过 setContext 覆盖
  },
}));

/** Hook: 当前活动实例 */
export function useActiveInstance() {
  return useInstancesStore((s) => s.active);
}

/** Hook: 当前实例的 agent 列表 */
export function useActiveAgents() {
  return useInstancesStore((s) => s.agents);
}

/** Hook: 正在加载 agents */
export function useIsLoadingAgents() {
  return useInstancesStore((s) => s.loadingAgents);
}
