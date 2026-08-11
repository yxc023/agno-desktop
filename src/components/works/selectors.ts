import { useMemo } from "react";
import type {
  Activity,
  AgentPlatform,
  AuthorType,
  Requirement,
  Session,
  SessionStatus,
  StageKind,
} from "./types";
import {
  PLATFORM_LABEL,
  STATUS_LABEL,
  STAGE_DEFINITIONS,
  STAGE_LABEL,
  STAGE_LABEL_CN,
} from "./mock-requirements";
import { useRequirementsStore } from "@/stores/requirements-store";

export function useRequirement(id: string | null): Requirement | null {
  const requirements = useRequirementsStore((s) => s.requirements);
  return useMemo(() => {
    if (!id) return null;
    return requirements.find((r) => r.id === id) ?? null;
  }, [id, requirements]);
}

export function useRequirements(filter?: {
  status?: Requirement["status"];
  search?: string;
}): Requirement[] {
  const requirements = useRequirementsStore((s) => s.requirements);
  return useMemo(() => {
    let list = requirements;
    if (filter?.status) list = list.filter((r) => r.status === filter.status);
    const q = filter?.search?.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.id.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.assignees.some((a) => a.name.toLowerCase().includes(q))
      );
    }
    return list;
  }, [requirements, filter?.status, filter?.search]);
}

export function useSessionsByRequirement(req: Requirement | null): Session[] {
  return useMemo(() => {
    if (!req) return [];
    return [...req.sessions].sort((a, b) => b.startedAt - a.startedAt);
  }, [req]);
}

export function platformColor(p: AgentPlatform): {
  fg: string;
  bg: string;
  border: string;
  mono: string;
} {
  switch (p) {
    case "agno":
      return {
        fg: "text-info",
        bg: "bg-info/15",
        border: "border-info/40",
        mono: "AGNO",
      };
    case "claude-code":
      return {
        fg: "text-accent",
        bg: "bg-accent/15",
        border: "border-accent/40",
        mono: "Claude Code",
      };
    case "opencode":
      return {
        fg: "text-success",
        bg: "bg-success/15",
        border: "border-success/40",
        mono: "opencode",
      };
    case "codex":
      return {
        fg: "text-warning",
        bg: "bg-warning/15",
        border: "border-warning/40",
        mono: "Codex",
      };
    case "human":
      return {
        fg: "text-foreground/85",
        bg: "bg-foreground/[0.06]",
        border: "border-foreground/20",
        mono: "Human",
      };
  }
}

export function statusColor(s: SessionStatus): string {
  switch (s) {
    case "running":
      return "bg-info";
    case "completed":
      return "bg-success";
    case "failed":
      return "bg-destructive";
    case "paused":
      return "bg-warning";
    case "ask_user":
      return "bg-warning";
    case "cancelled":
      return "bg-muted-foreground/40";
  }
}

export function statusTextClass(s: SessionStatus): string {
  switch (s) {
    case "running":
      return "text-info";
    case "completed":
      return "text-success";
    case "failed":
      return "text-destructive";
    case "paused":
      return "text-warning";
    case "ask_user":
      return "text-warning";
    case "cancelled":
      return "text-muted-foreground";
  }
}

export function statusLabel(s: SessionStatus): string {
  return STATUS_LABEL[s];
}

export function authorChipColor(t: AuthorType): string {
  return t === "human"
    ? "border-foreground/20 bg-foreground/[0.06] text-foreground/85"
    : "border-accent/30 bg-accent/10 text-accent";
}

export function shortSha(s: string): string {
  return s.slice(0, 7);
}

export function stageLabelCN(k: StageKind): string {
  return STAGE_LABEL_CN[k] ?? STAGE_LABEL[k];
}

export function platformLabelCN(p: AgentPlatform): string {
  return PLATFORM_LABEL[p];
}

export function stageDefinition(kind: StageKind) {
  return STAGE_DEFINITIONS[kind];
}

export function getActivitiesByKind(req: Requirement, kind: Activity["kind"]): Activity[] {
  return req.activities.filter((a) => a.kind === kind);
}

export {
  PLATFORM_LABEL,
  STATUS_LABEL,
  STAGE_LABEL,
  STAGE_LABEL_CN,
  STAGE_DEFINITIONS,
};