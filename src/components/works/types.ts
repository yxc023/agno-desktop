export type AgentPlatform = "agno" | "claude-code" | "opencode" | "codex" | "human";

export type StageKind = "plan" | "do" | "check" | "deliver";

export type RequirementStatus = "active" | "paused" | "delivered" | "archived";

export type SessionStatus =
  | "running"
  | "paused"
  | "ask_user"
  | "completed"
  | "failed"
  | "cancelled";

export type DocKind =
  | "clarification"
  | "research"
  | "spec"
  | "design"
  | "adr"
  | "test-plan"
  | "risk"
  | "report"
  | "other";

export type AuthorType = "human" | "agent";

export interface Assignee {
  kind: "human" | "agent";
  name: string;
  platform?: AgentPlatform;
  avatar?: string;
}

export interface Participant {
  kind: "human" | "agent";
  name: string;
  platform?: AgentPlatform;
  role: string;
}

// ---------------- Session ----------------

export interface Session {
  id: string;
  requirementId: string;
  platform: Exclude<AgentPlatform, "human">;
  externalRef: string;
  title: string;
  status: SessionStatus;
  participants: Participant[];
  startedAt: number;
  endedAt?: number;
  pausedAt?: number;
  resumedAt?: number;
  lastActivityAt: number;
  toolCount?: number;
  messageCount: number;
  durationMs?: number;
}

// ---------------- Document / Artifact ----------------

export interface Document {
  filePath: string;
  title: string;
  excerpt: string;
  body?: string;
  kind: DocKind;
  stage?: StageKind;
  lastEditedBy: AgentPlatform;
  lastEditedByName: string;
  lastEditedAt: number;
  sizeBytes?: number;
  lineCount?: number;
}

// ---------------- Branch / MR / Commit ----------------

export interface Branch {
  repoPath: string;
  name: string;
  lastCommitSha: string;
  aheadBy: number;
  behindBy: number;
  authorType: AuthorType;
  authorPlatform?: AgentPlatform;
  authorName: string;
  updatedAt: number;
  externalUrl?: string;
}

export interface MR {
  repoPath: string;
  iid: number;
  title: string;
  status: "open" | "merged" | "closed" | "draft";
  branch: string;
  targetBranch: string;
  authorType: AuthorType;
  authorPlatform?: AgentPlatform;
  authorName: string;
  externalUrl?: string;
  updatedAt: number;
}

export interface Commit {
  sha: string;
  repoPath: string;
  message: string;
  authorType: AuthorType;
  authorPlatform?: AgentPlatform;
  authorName: string;
  timestamp: number;
  filesChanged: string[];
}

// ---------------- Stage (definition only) ----------------

export interface StageDefinition {
  kind: StageKind;
  description: string;
  suggestedAgents: Array<{ name: string; platform: AgentPlatform }>;
}

// ---------------- Activity (discrete events) ----------------

export interface ActivityBase {
  id: string;
  requirementId: string;
  at: number;
  authorType: AuthorType;
  authorName: string;
  authorPlatform?: AgentPlatform;
  sessionRef?: string;
}

export interface CommentActivity extends ActivityBase {
  kind: "comment";
  content: string;
  parentId?: string;
  resolved?: boolean;
}

export interface StageTransitionActivity extends ActivityBase {
  kind: "stage-transition";
  fromStage: StageKind | null;
  toStage: StageKind;
  reason?: string;
}

export interface AgentNoteActivity extends ActivityBase {
  kind: "agent-note";
  content: string;
}

export type Activity = CommentActivity | StageTransitionActivity | AgentNoteActivity;

// ---------------- Requirement ----------------

export interface Requirement {
  id: string;
  title: string;
  description: string;
  status: RequirementStatus;
  createdAt: number;
  updatedAt: number;
  assignees: Assignee[];
  repos: string[];
  currentStage: StageKind;
  activities: Activity[];
  documents: Document[];
  branches: Branch[];
  mrs: MR[];
  commits: Commit[];
  sessions: Session[];
}