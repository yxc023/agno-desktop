/**
 * Requirements store —— demo mock 的内存 store，包装 REQUIREMENTS 数组
 * 提供 stage transition + comment 添加等 action 让 demo"活"起来
 *
 * 不持久化（localStorage 不写）—— demo 期间内存保持，刷新页面会重置
 */

import { create } from "zustand";
import type {
  Activity,
  AuthorType,
  CommentActivity,
  Requirement,
  StageTransitionActivity,
} from "@/components/works/types";
import { REQUIREMENTS, SESSIONS } from "@/components/works/mock-requirements";

interface TransitionPayload {
  toStage: import("@/components/works/types").StageKind;
  actorType: AuthorType;
  actorName: string;
  actorPlatform?: import("@/components/works/types").AgentPlatform;
  reason?: string;
}

interface AddCommentPayload {
  content: string;
  authorType: AuthorType;
  authorName: string;
  authorPlatform?: import("@/components/works/types").AgentPlatform;
  parentId?: string;
}

interface RequirementsState {
  requirements: Requirement[];
  transitionStage: (reqId: string, payload: TransitionPayload) => void;
  addComment: (reqId: string, payload: AddCommentPayload) => void;
  toggleResolveComment: (reqId: string, activityId: string) => void;
}

function makeActivityId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useRequirementsStore = create<RequirementsState>((set) => ({
  requirements: REQUIREMENTS,

  transitionStage: (reqId, payload) => {
    set((state) => ({
      requirements: state.requirements.map((r) => {
        if (r.id !== reqId) return r;
        const transition: StageTransitionActivity = {
          id: makeActivityId("act"),
          requirementId: reqId,
          at: Date.now(),
          kind: "stage-transition",
          fromStage: r.currentStage,
          toStage: payload.toStage,
          authorType: payload.actorType,
          authorName: payload.actorName,
          authorPlatform: payload.actorPlatform,
          reason: payload.reason,
        };
        return {
          ...r,
          currentStage: payload.toStage,
          updatedAt: Date.now(),
          activities: [transition, ...r.activities],
        };
      }),
    }));
  },

  addComment: (reqId, payload) => {
    set((state) => ({
      requirements: state.requirements.map((r) => {
        if (r.id !== reqId) return r;
        const comment: CommentActivity = {
          id: makeActivityId("act"),
          requirementId: reqId,
          at: Date.now(),
          kind: "comment",
          authorType: payload.authorType,
          authorName: payload.authorName,
          authorPlatform: payload.authorPlatform,
          content: payload.content,
          parentId: payload.parentId,
        };
        return {
          ...r,
          updatedAt: Date.now(),
          activities: [comment, ...r.activities],
        };
      }),
    }));
  },

  toggleResolveComment: (reqId, activityId) => {
    set((state) => ({
      requirements: state.requirements.map((r) => {
        if (r.id !== reqId) return r;
        return {
          ...r,
          activities: r.activities.map((a: Activity) => {
            if (a.id !== activityId || a.kind !== "comment") return a;
            return { ...a, resolved: !a.resolved };
          }),
        };
      }),
    }));
  },
}));

// 保留 SESSIONS 导出（其他模块仍在用）
export { SESSIONS };