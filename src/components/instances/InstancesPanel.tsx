import { Link } from "react-router-dom";
import { useActiveInstance, useInstancesStore } from "@/stores/instances-store";
import { Badge } from "@/components/ui/badge";
import {
  Cpu,
  ArrowUpRight,
  WifiOff,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";

export function InstancesPanel() {
  const active = useActiveInstance();
  const probe = useInstancesStore((s) => s.probeInstance);
  const loadAgents = useInstancesStore((s) => s.loadAgents);
  const newSession = useChatStore((s) => s.newSession);

  if (!active) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-muted/50 text-muted-foreground/60">
          <WifiOff className="h-4 w-4" />
        </div>
        <p className="text-[12.5px] font-medium">暂无活跃实例</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          请先在「实例」页面添加
        </p>
        <Button asChild size="sm" className="mt-3">
          <Link to="/instances">前往管理</Link>
        </Button>
      </div>
    );
  }

  const info = active.lastInfo;
  const isStale =
    !active.lastProbeAt || Date.now() - active.lastProbeAt > 60_000;

  return (
    <div className="space-y-2.5">
      {/* 实例健康状态 */}
      <section className="rounded-md border bg-card/40 p-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span
                className={`absolute inset-0 animate-ping rounded-full ${
                  isStale ? "bg-muted-foreground/40" : "bg-success/60"
                }`}
              />
              <span
                className={`relative h-1.5 w-1.5 rounded-full ${
                  isStale ? "bg-muted-foreground/60" : "bg-success"
                }`}
              />
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              instance
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              probe(active.id);
              loadAgents(active.id, true);
            }}
            className="h-6 w-6"
            title="重新探活"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
        <div className="text-[12.5px] font-semibold tracking-tight">
          {active.name}
        </div>
        <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
          {active.baseUrl}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/70">
          <span>AGNO {active.lastInfo?.agno_version ?? "—"}</span>
          {active.token && (
            <Badge variant="outline" className="font-mono text-[9px]">
              JWT
            </Badge>
          )}
        </div>
      </section>

      {/* Runtime counts（紧凑单行） */}
      <section className="rounded-md border bg-card/40">
        <div className="flex items-center justify-between border-b px-2.5 py-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            runtime
          </span>
          {active.lastProbeAt && (
            <span className="font-mono text-[10px] text-muted-foreground/60">
              {formatRelativeTime(active.lastProbeAt)}
            </span>
          )}
        </div>
        <div className="flex divide-x divide-border/50">
          {info ? (
            <>
              <CountChip label="agents" value={info.agent_count ?? 0} />
              <CountChip label="teams" value={info.team_count ?? 0} />
              <CountChip label="flows" value={info.workflow_count ?? 0} />
            </>
          ) : (
            <>
              <Skeleton className="h-9 flex-1 rounded-none" />
              <Skeleton className="h-9 flex-1 rounded-none" />
              <Skeleton className="h-9 flex-1 rounded-none" />
            </>
          )}
        </div>
      </section>

      {/* Agent 列表（点击即开新会话） */}
      {active.agents && active.agents.length > 0 && (
        <section className="rounded-md border bg-card/40">
          <div className="flex items-center justify-between border-b px-2.5 py-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              agents
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/60">
              {active.agents.length}
            </span>
          </div>
          <div className="max-h-[40vh] space-y-0.5 overflow-y-auto p-1.5">
            {active.agents.map((a) => (
              <button
                key={a.id}
                onClick={() => newSession(a.id)}
                className="group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-accent/30"
                title={`新建会话：${a.name ?? a.id}`}
              >
                <Cpu className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-medium">
                    {a.name ?? a.id}
                  </div>
                  {a.model && (
                    <div className="truncate font-mono text-[10px] text-muted-foreground/70">
                      {typeof a.model === "object"
                        ? (a.model as any).name
                        : a.model}
                    </div>
                  )}
                </div>
                <ArrowUpRight className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground/60" />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CountChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 px-2.5 py-1.5">
      <div className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/70">
        {label}
      </div>
      <div className="font-mono text-[12.5px] font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}