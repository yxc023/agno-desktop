import { useMemo, useState } from "react";
import { GitBranch, GitPullRequest, GitMerge, GitPullRequestArrow, ExternalLink } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { Commit, MR, Requirement } from "./types";
import { AuthorChip } from "./badges";
import { shortSha } from "./selectors";

interface GitTabProps {
  requirement: Requirement;
}

export function GitTab({ requirement }: GitTabProps) {
  const humanCount = requirement.commits.filter((c) => c.authorType === "human").length;
  const agentCount = requirement.commits.length - humanCount;

  const projects = useMemo(() => {
    const counts = new Map<string, number>();
    const paths = new Map<string, string>();
    for (const m of [...requirement.mrs, ...requirement.branches]) {
      const proj = m.repoPath.split("/").pop() ?? m.repoPath;
      counts.set(proj, (counts.get(proj) ?? 0) + 1);
      if (!paths.has(proj)) paths.set(proj, m.repoPath);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count, repoPath: paths.get(name) ?? "" }))
      .sort((a, b) => b.count - a.count);
  }, [requirement.mrs, requirement.branches]);

  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const filteredMRs = useMemo(
    () =>
      selectedProject === null
        ? requirement.mrs
        : requirement.mrs.filter((m) => m.repoPath.split("/").pop() === selectedProject),
    [requirement.mrs, selectedProject]
  );
  const filteredBranches = useMemo(
    () =>
      selectedProject === null
        ? requirement.branches
        : requirement.branches.filter((b) => b.repoPath.split("/").pop() === selectedProject),
    [requirement.branches, selectedProject]
  );

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 px-5 py-4">
        <ProjectFilter
          projects={projects}
          selected={selectedProject}
          onSelect={setSelectedProject}
          totalMR={requirement.mrs.length}
          totalBranch={requirement.branches.length}
        />

        <section>
          <SectionHeader>
            <span>merge requests</span>
            <span className="font-mono text-[10px] text-muted-foreground/55">
              {filteredMRs.length}
              {selectedProject && (
                <span className="text-muted-foreground/40"> / {requirement.mrs.length}</span>
              )}
              {" "}全部
            </span>
          </SectionHeader>
          <div className="mt-2 space-y-1">
            {filteredMRs.map((mr) => (
              <MRRow key={`${mr.repoPath}::${mr.iid}`} mr={mr} />
            ))}
            {filteredMRs.length === 0 && (
              <Empty>{selectedProject ? `当前项目无 MR` : "暂无 MR"}</Empty>
            )}
          </div>
        </section>

        <section>
          <SectionHeader>
            <span>branches</span>
            <span className="font-mono text-[10px] text-muted-foreground/55">
              {filteredBranches.length}
              {selectedProject && (
                <span className="text-muted-foreground/40"> / {requirement.branches.length}</span>
              )}
              {" "}· 点击行在 GitLab 打开
            </span>
          </SectionHeader>
          <div className="mt-2 space-y-1">
            {filteredBranches.map((b) => (
              <BranchRow key={`${b.repoPath}::${b.name}`} branch={b} />
            ))}
            {filteredBranches.length === 0 && (
              <Empty>{selectedProject ? `当前项目无关联分支` : "暂无关联分支"}</Empty>
            )}
          </div>
        </section>

        <section>
          <SectionHeader>
            <span>commits</span>
            <span className="ml-auto flex items-center gap-2 font-mono text-[10px]">
              <span className="inline-flex items-center gap-1 text-foreground/80">
                <span className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
                {humanCount} human
              </span>
              <span className="text-muted-foreground/40">·</span>
              <span className="inline-flex items-center gap-1 text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                {agentCount} agent
              </span>
            </span>
          </SectionHeader>
          <ol className="mt-2 space-y-0.5">
            {requirement.commits.map((c, i) => (
              <CommitRow key={c.sha} commit={c} isLast={i === requirement.commits.length - 1} />
            ))}
          </ol>
        </section>

        <p className="font-mono text-[10px] leading-relaxed text-muted-foreground/55">
          Git tab 只展示引用与时间线；代码查看、文件 diff、PR 评论等操作请到 GitLab。
        </p>
      </div>
    </ScrollArea>
  );
}

function ProjectFilter({
  projects,
  selected,
  onSelect,
}: {
  projects: Array<{ name: string; count: number; repoPath: string }>;
  selected: string | null;
  onSelect: (name: string | null) => void;
  totalMR: number;
  totalBranch: number;
}) {
  if (projects.length === 0) return null;
  const total = projects.reduce((s, p) => s + p.count, 0);
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto">
      <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/55">
        project
      </span>
      <FilterPill
        active={selected === null}
        onClick={() => onSelect(null)}
        title="全部项目"
      >
        全部
        <span className="ml-1 font-mono text-[9.5px] opacity-60">{total}</span>
      </FilterPill>
      {projects.map((p) => (
        <FilterPill
          key={p.name}
          active={selected === p.name}
          onClick={() => onSelect(selected === p.name ? null : p.name)}
          title={p.repoPath}
        >
          {p.name}
          <span className="ml-1 font-mono text-[9.5px] opacity-60">{p.count}</span>
        </FilterPill>
      ))}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border px-2 py-1 text-[11px] transition-all",
        active
          ? "border-accent/50 bg-accent/[0.12] text-accent"
          : "border-border/60 bg-card/40 text-muted-foreground/80 hover:border-border hover:text-foreground/85"
      )}
    >
      {children}
    </button>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/55">
      {children}
    </h3>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-3 py-3 text-center font-mono text-[10px] text-muted-foreground/50">
      {children}
    </div>
  );
}

function openExternal(url?: string) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function BranchRow({ branch }: { branch: Requirement["branches"][number] }) {
  return (
    <button
      type="button"
      onClick={() => openExternal(branch.externalUrl)}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2.5 py-1.5 text-left transition-all",
        "hover:border-accent/40 hover:bg-sidebar-accent/40",
        !branch.externalUrl && "cursor-default opacity-70"
      )}
      title={branch.externalUrl ?? "未配置 gitlab url (demo)"}
      disabled={!branch.externalUrl}
    >
      <GitBranch className="h-3 w-3 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-[11px] font-medium text-foreground/90">
            {branch.name}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/55">
            {shortSha(branch.lastCommitSha)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/65">
          <span title={branch.repoPath} className="truncate">
            {branch.repoPath.split("/").pop()}
          </span>
          <span className="text-muted-foreground/30">·</span>
          <span className="text-success">↑{branch.aheadBy}</span>
          {branch.behindBy > 0 && (
            <>
              <span className="text-muted-foreground/30">·</span>
              <span className="text-warning">↓{branch.behindBy}</span>
            </>
          )}
          <span className="text-muted-foreground/30">·</span>
          <span>{formatRelativeTime(branch.updatedAt)}</span>
        </div>
      </div>
      <AuthorChip
        type={branch.authorType}
        name={branch.authorName}
        platform={branch.authorPlatform}
      />
      <ExternalLink
        className={cn(
          "h-3 w-3 shrink-0 text-muted-foreground/30 transition-colors",
          "group-hover:text-accent"
        )}
      />
    </button>
  );
}

function MRRow({ mr }: { mr: MR }) {
  const Icon =
    mr.status === "merged"
      ? GitMerge
      : mr.status === "closed"
      ? GitPullRequest
      : GitPullRequestArrow;
  const variant =
    mr.status === "merged"
      ? "success"
      : mr.status === "closed"
      ? "secondary"
      : mr.status === "draft"
      ? "outline"
      : "info";
  return (
    <button
      type="button"
      onClick={() => openExternal(mr.externalUrl)}
      className={cn(
        "group flex w-full items-center gap-2 rounded-md border border-border/60 bg-card/40 px-2.5 py-1.5 text-left transition-all",
        "hover:border-accent/40 hover:bg-sidebar-accent/40",
        !mr.externalUrl && "cursor-default opacity-70"
      )}
      title={mr.externalUrl ?? "未配置 gitlab url (demo)"}
      disabled={!mr.externalUrl}
    >
      <Icon
        className={cn(
          "h-3 w-3 shrink-0",
          mr.status === "merged" && "text-success",
          mr.status === "closed" && "text-muted-foreground",
          mr.status === "open" && "text-info",
          mr.status === "draft" && "text-muted-foreground"
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10.5px] text-muted-foreground/70">
            !{mr.iid}
          </span>
          <span className="truncate text-[12px]">{mr.title}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/65">
          <span title={mr.repoPath} className="truncate">
            {mr.repoPath.split("/").pop()}
          </span>
          <span className="text-muted-foreground/30">·</span>
          <span className="truncate">
            {mr.branch} <span className="text-muted-foreground/40">→</span> {mr.targetBranch}
          </span>
        </div>
      </div>
      <Badge
        variant={variant as any}
        className="shrink-0 font-mono text-[9.5px] tracking-wider"
      >
        {mr.status}
      </Badge>
      <AuthorChip type={mr.authorType} name={mr.authorName} platform={mr.authorPlatform} />
      <ExternalLink
        className={cn(
          "h-3 w-3 shrink-0 text-muted-foreground/30 transition-colors",
          "group-hover:text-accent"
        )}
      />
    </button>
  );
}

function CommitRow({ commit, isLast }: { commit: Commit; isLast: boolean }) {
  const isHuman = commit.authorType === "human";
  return (
    <li className="relative flex items-start gap-2 pb-2">
      <div className="relative flex w-3 shrink-0 flex-col items-center pt-1">
        <span
          className={cn(
            "h-2 w-2 rounded-full ring-2",
            isHuman
              ? "bg-foreground/70 ring-foreground/20"
              : "bg-accent ring-accent/30"
          )}
        />
        {!isLast && (
          <span className="absolute top-3 h-full w-px bg-border/60" aria-hidden />
        )}
      </div>
      <div className="min-w-0 flex-1 rounded-md border border-border/60 bg-card/40 px-2.5 py-1.5 transition-all hover:border-border">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10.5px] text-muted-foreground/70">
                {shortSha(commit.sha)}
              </span>
              <span className="truncate text-[12px]">{commit.message}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/65">
              <span title={commit.repoPath} className="truncate">
                {commit.repoPath.split("/").pop()}
              </span>
              <span className="text-muted-foreground/30">·</span>
              <span>
                {commit.filesChanged.length} file{commit.filesChanged.length === 1 ? "" : "s"}
              </span>
              <span className="text-muted-foreground/30">·</span>
              <span>{formatRelativeTime(commit.timestamp)}</span>
            </div>
          </div>
          <AuthorChip
            type={commit.authorType}
            name={commit.authorName}
            platform={commit.authorPlatform}
          />
        </div>
      </div>
    </li>
  );
}