import { Briefcase, Search, Plus, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { Requirement, RequirementStatus } from "./types";
import { useRequirements } from "./selectors";
import { stageLabelCN } from "./selectors";
import { useRequirementsStore } from "@/stores/requirements-store";

const STATUS_TABS: Array<{ value: "all" | RequirementStatus; label: string }> = [
  { value: "all", label: "全部" },
  { value: "active", label: "进行中" },
  { value: "paused", label: "暂停" },
  { value: "delivered", label: "已交付" },
];

const STATUS_TEXT: Record<RequirementStatus, string> = {
  active: "进行中",
  paused: "暂停",
  delivered: "已交付",
  archived: "归档",
};

const STATUS_COLOR: Record<RequirementStatus, string> = {
  active: "bg-info",
  paused: "bg-warning",
  delivered: "bg-success",
  archived: "bg-muted-foreground/50",
};

interface RequirementListProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  statusFilter: "all" | RequirementStatus;
  setStatusFilter: (s: "all" | RequirementStatus) => void;
  search: string;
  setSearch: (s: string) => void;
}

export function RequirementList({
  selectedId,
  onSelect,
  statusFilter,
  setStatusFilter,
  search,
  setSearch,
}: RequirementListProps) {
  const list = useRequirements({
    status: statusFilter === "all" ? undefined : statusFilter,
    search,
  });
  const all = useRequirements({});
  const counts: Record<string, number> = { all: all.length };
  for (const r of all) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const createDemoRequirement = useRequirementsStore((s) => s.createDemoRequirement);

  function handleDemo() {
    const newId = createDemoRequirement();
    onSelect(newId);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-sidebar-border px-3 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Briefcase className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[12px] font-medium">需求</span>
            <Badge
              variant="outline"
              className="h-4 px-1.5 font-mono text-[9.5px] tracking-wider text-accent"
            >
              实验性
            </Badge>
            <span className="font-mono text-[10px] text-muted-foreground/70">
              {counts.all}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-1.5 text-[10.5px] text-accent hover:bg-accent/10"
              title="新建一条空需求，进入演示 workflow"
              onClick={handleDemo}
            >
              <Sparkles className="h-3 w-3" />
              新建需求
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-6 w-6"
              title="新建需求 (demo: disabled)"
              disabled
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索需求 / assignee..."
            className="h-7 pl-7 font-mono text-[11px]"
          />
        </div>

        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as "all" | RequirementStatus)}>
          <TabsList className="h-7 w-full justify-start gap-0.5 bg-transparent p-0">
            {STATUS_TABS.map((f) => (
              <TabsTrigger
                key={f.value}
                value={f.value}
                className={cn(
                  "h-6 rounded-md px-2 font-mono text-[10.5px] data-[state=active]:bg-sidebar-accent data-[state=active]:shadow-none",
                  "data-[state=active]:text-foreground"
                )}
              >
                {f.label}
                {counts[f.value] != null && counts[f.value] > 0 && (
                  <span className="ml-1 text-muted-foreground/60">{counts[f.value]}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <ScrollArea className="flex-1">
        <div className="min-w-0 space-y-1 overflow-hidden p-1.5">
          {list.length === 0 && (
            <div className="px-3 py-12 text-center">
              <div className="mx-auto mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-muted/50 text-muted-foreground/50">
                <Briefcase className="h-4 w-4" />
              </div>
              <p className="text-[12px] text-muted-foreground">没有匹配的需求</p>
            </div>
          )}
          {list.map((r, i) => (
            <RequirementListItem
              key={r.id}
              req={r}
              index={i}
              selected={selectedId === r.id}
              onClick={() => onSelect(r.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function RequirementListItem({
  req,
  index,
  selected,
  onClick,
}: {
  req: Requirement;
  index: number;
  selected: boolean;
  onClick: () => void;
}) {
  const stage = req.currentStage;
  const isActiveStage = req.status === "active" || req.status === "paused";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
      className={cn(
        "group relative w-full min-w-0 cursor-pointer animate-fade-in overflow-hidden rounded-md px-3 py-2.5 text-left transition-all",
        "hover:bg-sidebar-accent/50",
        selected ? "bg-sidebar-accent" : "bg-transparent"
      )}
    >
      {selected && (
        <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-accent" />
      )}
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-1.5 h-2 w-2 shrink-0 rounded-full ring-2",
            STATUS_COLOR[req.status],
            req.status === "active" && "ring-info/30",
            req.status === "paused" && "ring-warning/30",
            req.status === "delivered" && "ring-success/30"
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-[10px] font-medium text-muted-foreground/70">
              {req.id}
            </span>
            <span className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/55">
              {STATUS_TEXT[req.status]}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[12.5px] font-medium">{req.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground/65">
            {isActiveStage && (
              <>
                <Loader2
                  className={cn(
                    "h-2.5 w-2.5",
                    req.status === "active" ? "animate-spin text-accent" : "text-warning"
                  )}
                />
                <span className={cn(req.status === "active" ? "text-accent" : "text-warning")}>
                  {stage} · {stageLabelCN(stage)}
                </span>
                <span className="text-muted-foreground/40">·</span>
              </>
            )}
            {!isActiveStage && (
              <span className="text-muted-foreground/70">
                {stage} · {stageLabelCN(stage)}
              </span>
            )}
            <span className="text-muted-foreground/40">·</span>
            <span>{formatRelativeTime(req.updatedAt)}</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{req.activities.length} act</span>
          </div>
        </div>
        <ChevronRight
          className={cn(
            "mt-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/30 transition-all",
            "group-hover:translate-x-0.5 group-hover:text-muted-foreground/60",
            selected && "text-accent"
          )}
        />
      </div>
    </button>
  );
}