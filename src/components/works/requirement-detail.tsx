import { useState } from "react";
import {
  Briefcase,
  Play,
  GitBranch,
  GitPullRequest,
  FileText,
  Users,
  MessagesSquare,
  Activity,
  GitCommit,
  Package,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRelativeTime } from "@/lib/utils";
import type { Requirement } from "./types";
import { useRequirementsStore } from "@/stores/requirements-store";
import { AuthorChip } from "./badges";
import { SessionsTab } from "./sessions-tab";
import { ActivityTab } from "./activity-tab";
import { GitTab } from "./git-tab";
import { ArtifactsTab } from "./artifacts-tab";
import { StageHeader } from "./stage-header";
import { StartSessionDialog } from "./start-session-dialog";

const STATUS_BADGE: Record<Requirement["status"], { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" | "outline" }> = {
  active: { label: "进行中", variant: "secondary" },
  paused: { label: "暂停", variant: "warning" },
  delivered: { label: "已交付", variant: "success" },
  archived: { label: "归档", variant: "outline" },
};

function repoBase(p: string): string {
  return p.split("/").pop() ?? p;
}

interface RequirementDetailProps {
  requirement: Requirement | null;
}

export function RequirementDetail({ requirement }: RequirementDetailProps) {
  const [startOpen, setStartOpen] = useState(false);

  // 从 store 取（支持 stage transition 等 mutation）
  const live = useRequirementsStore((s) =>
    requirement ? s.requirements.find((r) => r.id === requirement.id) ?? requirement : requirement
  );

  if (!live) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center text-muted-foreground">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-muted/40 text-muted-foreground/50">
          <Briefcase className="h-5 w-5" />
        </div>
        <p className="text-[12.5px]">选中一条需求查看详情</p>
        <p className="mt-1 font-mono text-[10.5px] text-muted-foreground/55">
          左侧任意一项
        </p>
      </div>
    );
  }

  const badgeMeta = STATUS_BADGE[live.status];

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 space-y-3 border-b border-sidebar-border bg-background/60 px-5 py-4 backdrop-blur">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-medium text-muted-foreground/70">
                {live.id}
              </span>
              <Badge variant={badgeMeta.variant} className="font-mono text-[10px]">
                {badgeMeta.label}
              </Badge>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground/55">
                updated {formatRelativeTime(live.updatedAt)}
              </span>
            </div>
            <h1 className="mt-1.5 truncate text-[16px] font-semibold">{live.title}</h1>
            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground/85">
              {live.description}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              className="h-8"
              onClick={() => setStartOpen(true)}
              title="启动一个新会话（自动绑定到本需求）"
            >
              <Play className="h-3 w-3" />
              启动会话
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px]">
          <div className="flex items-center gap-1.5 text-muted-foreground/70">
            <Users className="h-3 w-3" />
            <span>assignees</span>
            <span className="text-muted-foreground/40">·</span>
          </div>
          {live.assignees.map((a) => (
            <AuthorChip
              key={a.name}
              type={a.kind}
              name={a.name}
              platform={a.platform}
              avatar={a.avatar}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-[10.5px] text-muted-foreground/75">
          <div className="flex items-center gap-1.5">
            <GitBranch className="h-3 w-3" />
            <span>repos</span>
            <span className="text-muted-foreground/40">·</span>
          </div>
          {live.repos.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5"
              title={p}
            >
              <span className="text-foreground/85">{repoBase(p)}</span>
            </span>
          ))}
          <span className="text-muted-foreground/40">·</span>
          <span className="inline-flex items-center gap-1 text-muted-foreground/65">
            <GitBranch className="h-3 w-3" />
            {live.branches.length} branch{live.branches.length === 1 ? "" : "es"}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="inline-flex items-center gap-1 text-muted-foreground/65">
            <GitPullRequest className="h-3 w-3" />
            {live.mrs.length} MR{live.mrs.length === 1 ? "" : "s"}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="inline-flex items-center gap-1 text-muted-foreground/65">
            <FileText className="h-3 w-3" />
            {live.documents.length} artifact{live.documents.length === 1 ? "" : "s"}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="inline-flex items-center gap-1 text-muted-foreground/65">
            <Activity className="h-3 w-3" />
            {live.activities.length} activity
          </span>
        </div>

        <StageHeader requirement={live} />
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <Tabs defaultValue="sessions" className="flex h-full flex-col">
          <div className="shrink-0 border-b border-sidebar-border px-5 pt-2">
            <TabsList className="h-8 bg-transparent p-0">
              <TabsTrigger
                value="sessions"
                className="h-7 rounded-md px-3 font-mono text-[11px] data-[state=active]:bg-sidebar-accent data-[state=active]:shadow-none"
              >
                <MessagesSquare className="mr-1.5 h-3 w-3" />
                Sessions
              </TabsTrigger>
              <TabsTrigger
                value="activity"
                className="h-7 rounded-md px-3 font-mono text-[11px] data-[state=active]:bg-sidebar-accent data-[state=active]:shadow-none"
              >
                <Activity className="mr-1.5 h-3 w-3" />
                Activity
              </TabsTrigger>
              <TabsTrigger
                value="git"
                className="h-7 rounded-md px-3 font-mono text-[11px] data-[state=active]:bg-sidebar-accent data-[state=active]:shadow-none"
              >
                <GitCommit className="mr-1.5 h-3 w-3" />
                Git
              </TabsTrigger>
              <TabsTrigger
                value="artifacts"
                className="h-7 rounded-md px-3 font-mono text-[11px] data-[state=active]:bg-sidebar-accent data-[state=active]:shadow-none"
              >
                <Package className="mr-1.5 h-3 w-3" />
                Artifacts
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="sessions" className="mt-0 min-h-0 flex-1 overflow-hidden">
            <SessionsTab requirement={live} />
          </TabsContent>
          <TabsContent value="activity" className="mt-0 min-h-0 flex-1 overflow-hidden">
            <ActivityTab requirement={live} />
          </TabsContent>
          <TabsContent value="git" className="mt-0 min-h-0 flex-1 overflow-hidden">
            <GitTab requirement={live} />
          </TabsContent>
          <TabsContent value="artifacts" className="mt-0 min-h-0 flex-1 overflow-hidden">
            <ArtifactsTab requirement={live} />
          </TabsContent>
        </Tabs>
      </div>

      <StartSessionDialog
        requirement={live}
        open={startOpen}
        onOpenChange={setStartOpen}
      />
    </div>
  );
}