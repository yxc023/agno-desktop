import { Link } from "react-router-dom";
import { useActiveInstance, useInstancesStore } from "@/stores/instances-store";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  Cpu,
  Globe,
  Terminal,
  ArrowUpRight,
  Wifi,
  WifiOff,
  RefreshCw,
  Keyboard,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatRelativeTime } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";

const SHORTCUTS = [
  { keys: "⌘ K", label: "命令面板" },
  { keys: "⌘ N", label: "新建会话" },
  { keys: "⌘ /", label: "聚焦输入框" },
  { keys: "⌘ ⇧ O", label: "切换实例" },
  { keys: "Esc", label: "停止生成" },
];

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
    <div className="space-y-3">
      {/* 实例健康状态 */}
      <section className="rounded-md border bg-card/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-success/60" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-success" />
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
        <div className="text-[13px] font-semibold tracking-tight">
          {active.name}
        </div>
        <div className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground">
          {active.baseUrl}
        </div>
        {active.token && (
          <Badge variant="outline" className="mt-1.5 font-mono text-[9.5px]">
            JWT auth
          </Badge>
        )}
      </section>

      {/* AGNO 元信息 */}
      <section className="rounded-md border bg-card/40">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            runtime
          </span>
          {isStale ? (
            <span className="font-mono text-[10px] text-muted-foreground/60">
              stale
            </span>
          ) : (
            <span className="font-mono text-[10px] text-success">live</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-px bg-border/50">
          {info ? (
            <>
              <Stat label="AGNO" value={info.agno_version ?? "—"} mono />
              <Stat label="agents" value={String(info.agent_count ?? 0)} mono />
              <Stat label="teams" value={String(info.team_count ?? 0)} mono />
              <Stat label="flows" value={String(info.workflow_count ?? 0)} mono />
            </>
          ) : (
            <>
              <Skeleton className="h-12 rounded-none" />
              <Skeleton className="h-12 rounded-none" />
              <Skeleton className="h-12 rounded-none" />
              <Skeleton className="h-12 rounded-none" />
            </>
          )}
        </div>
        {active.lastProbeAt && (
          <div className="border-t px-3 py-1.5 font-mono text-[10px] text-muted-foreground/60">
            probed {formatRelativeTime(active.lastProbeAt)}
          </div>
        )}
      </section>

      {/* Agent 列表 */}
      {active.agents && active.agents.length > 0 && (
        <section className="rounded-md border bg-card/40">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              agents
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/60">
              {active.agents.length}
            </span>
          </div>
          <div className="space-y-0.5 p-1.5">
            {active.agents.map((a) => (
              <button
                key={a.id}
                onClick={() => newSession(a.id)}
                className="group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-accent/30"
              >
                <Cpu className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium">
                    {a.name ?? a.id}
                  </div>
                  <div className="truncate font-mono text-[10px] text-muted-foreground/70">
                    {a.model && typeof a.model === "object"
                      ? a.model.name
                      : a.model ?? "—"}
                  </div>
                </div>
                <ArrowUpRight className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground/60" />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* 快捷键 */}
      <section className="rounded-md border bg-card/40">
        <div className="flex items-center gap-1.5 border-b px-3 py-2">
          <Keyboard className="h-3 w-3 text-muted-foreground" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            shortcuts
          </span>
        </div>
        <div className="space-y-0.5 p-1.5">
          {SHORTCUTS.map((s) => (
            <div
              key={s.keys}
              className="flex items-center justify-between rounded px-2 py-1 text-[11px] hover:bg-accent/20"
            >
              <span className="text-muted-foreground">{s.label}</span>
              <kbd className="rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
      </section>

      {/* Tip */}
      <div className="rounded-md border border-dashed bg-transparent p-3 text-[10.5px] text-muted-foreground/80">
        <div className="flex items-center gap-1 font-mono text-accent">
          <Zap className="h-3 w-3" />
          <span className="uppercase tracking-wider">tip</span>
        </div>
        <p className="mt-1 leading-relaxed">
          所有对话数据存于本地浏览器 localStorage，<br />切换实例时各自的 session 独立。
        </p>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-card p-2.5">
      <div className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/80">
        {label}
      </div>
      <div className={`mt-0.5 text-[13px] font-semibold ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}