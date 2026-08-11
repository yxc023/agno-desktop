import {
  Loader2,
  Pause,
  Hand,
  Check,
  X,
  Square,
  RotateCcw,
  CircleDot,
  Users,
  Clock,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn, formatRelativeTime, formatTime } from "@/lib/utils";
import type { Requirement, Session, SessionStatus } from "./types";
import {
  platformColor,
  statusColor,
  statusTextClass,
  useSessionsByRequirement,
} from "./selectors";
import { PlatformBadge } from "./badges";

const STATUS_ICON: Record<
  SessionStatus,
  React.ComponentType<{ className?: string }>
> = {
  running: Loader2,
  paused: Pause,
  ask_user: Hand,
  completed: Check,
  failed: X,
  cancelled: CircleDot,
};

function formatDuration(ms: number | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return remSec > 0 ? `${min}m${remSec}s` : `${min}m`;
}

function lastEndAt(s: Session): number | undefined {
  return s.endedAt ?? s.pausedAt;
}

function statusLabelCN(s: SessionStatus): string {
  switch (s) {
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "ask_user":
      return "ask_user · 需你介入";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

interface SessionsTabProps {
  requirement: Requirement;
}

export function SessionsTab({ requirement }: SessionsTabProps) {
  const all = useSessionsByRequirement(requirement);
  const running = all.filter((s) => s.status === "running");
  const askUser = all.filter((s) => s.status === "ask_user" || s.status === "paused");
  const recent = all
    .filter(
      (s) => s.status === "completed" || s.status === "failed" || s.status === "cancelled"
    )
    .slice(0, 6);

  return (
    <ScrollArea className="h-full">
      <div className="space-y-5 px-5 py-4">
        {running.length > 0 && (
          <Section label="running" count={running.length} accent="info">
            {running.map((s) => (
              <SessionCard key={s.id} session={s} />
            ))}
          </Section>
        )}
        {askUser.length > 0 && (
          <Section label="ask_user · 需你介入" count={askUser.length} accent="warning">
            {askUser.map((s) => (
              <SessionCard key={s.id} session={s} />
            ))}
          </Section>
        )}
        {recent.length > 0 && (
          <Section label="recent · 已结束" count={recent.length} accent="muted">
            {recent.map((s) => (
              <SessionCard key={s.id} session={s} />
            ))}
          </Section>
        )}
        {all.length === 0 && (
          <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-3 py-8 text-center font-mono text-[10.5px] text-muted-foreground/50">
            该需求暂无 session · 点击 header 的「启动会话」发起
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

function Section({
  label,
  count,
  accent,
  children,
}: {
  label: string;
  count: number;
  accent: "info" | "warning" | "muted";
  children: React.ReactNode;
}) {
  const colorClass =
    accent === "info"
      ? "text-info"
      : accent === "warning"
      ? "text-warning"
      : "text-muted-foreground/65";
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className={cn("font-mono text-[10px] uppercase tracking-wider", colorClass)}>
          {label}
        </h3>
        <span className="font-mono text-[10px] text-muted-foreground/55">
          · {count}
        </span>
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function SessionCard({ session }: { session: Session }) {
  const StatusIcon = STATUS_ICON[session.status];
  const primary = session.participants.find((p) => p.role === "primary");
  const others = session.participants.filter((p) => p.role !== "primary");
  const endAt = lastEndAt(session);

  const lifecycleBits: string[] = [];
  if (session.pausedAt && session.resumedAt) {
    const pausedFor = formatDuration(session.resumedAt - session.pausedAt);
    lifecycleBits.push(
      `↻ resumed ${formatRelativeTime(session.resumedAt)} after ${pausedFor} pause`
    );
  } else if (session.pausedAt) {
    lifecycleBits.push(`⏸ paused ${formatRelativeTime(session.pausedAt)}`);
  } else if (session.resumedAt) {
    lifecycleBits.push(`↻ resumed ${formatRelativeTime(session.resumedAt)}`);
  }
  if (session.endedAt) {
    lifecycleBits.push(`✓ completed ${formatRelativeTime(session.endedAt)}`);
  }

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-md border bg-card/40 py-2.5 pl-3 pr-2 transition-all hover:border-border",
        session.status === "ask_user"
          ? "border-warning/40 bg-warning/[0.04]"
          : "border-border/60"
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-0 bottom-0 w-[2px] opacity-70",
          statusColor(session.status)
        )}
      />
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-background",
            session.status === "running" && "border-info/50",
            session.status === "completed" && "border-success/50",
            session.status === "failed" && "border-destructive/50",
            (session.status === "paused" || session.status === "ask_user") &&
              "border-warning/50"
          )}
        >
          <StatusIcon
            className={cn(
              "h-3 w-3",
              statusTextClass(session.status),
              session.status === "running" && "animate-spin"
            )}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <PlatformBadge platform={session.platform} size="sm" />
            <span className="font-mono text-[10px] text-muted-foreground/55">
              · {session.externalRef}
            </span>
            <span
              className={cn(
                "ml-auto font-mono text-[10px] uppercase tracking-wider",
                statusTextClass(session.status)
              )}
            >
              {statusLabelCN(session.status)}
            </span>
          </div>

          <div className="mt-1 truncate text-[12.5px] font-medium">{session.title}</div>

          <div className="mt-1.5 space-y-1 rounded-md border border-border/40 bg-muted/20 px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <Users className="h-2.5 w-2.5 text-muted-foreground/55" />
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/55">
                主体
              </span>
              <span className="font-mono text-[11px] text-foreground/90">
                {primary?.name ?? session.platform}
              </span>
              {primary?.platform && (
                <span
                  className={cn(
                    "font-mono text-[10px]",
                    platformColor(primary.platform).fg
                  )}
                >
                  ({platformColor(primary.platform).mono})
                </span>
              )}
              <span className="rounded border border-border/60 bg-background px-1 font-mono text-[9px] text-muted-foreground/65">
                {primary?.role ?? "primary"}
              </span>
            </div>
            {others.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground/55">
                  参与
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  {others.map((p) => {
                    const c = p.platform ? platformColor(p.platform) : null;
                    return (
                      <span
                        key={p.name + p.role}
                        className={cn(
                          "inline-flex items-center gap-1 rounded border px-1 py-px font-mono text-[10px]",
                          c
                            ? `${c.border} ${c.bg} ${c.fg}`
                            : "border-border/60 bg-muted/40 text-muted-foreground/80"
                        )}
                      >
                        {p.name}
                        <span className="text-[9px] opacity-70">· {p.role}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="mt-1.5 grid grid-cols-3 gap-2 font-mono text-[10px]">
            <div className="flex items-center gap-1 text-muted-foreground/70">
              <Clock className="h-2.5 w-2.5" />
              <span className="text-muted-foreground/55">开始</span>
              <span className="text-foreground/85">
                {formatTime(session.startedAt)}
              </span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground/70">
              <Clock className="h-2.5 w-2.5" />
              <span className="text-muted-foreground/55">
                {session.status === "running" ? "最近活动" : "最近结束"}
              </span>
              <span className="text-foreground/85">
                {formatTime(endAt ?? session.lastActivityAt)}
              </span>
            </div>
            <div className="flex items-center gap-1 text-muted-foreground/70">
              <MessageSquare className="h-2.5 w-2.5" />
              <span className="text-muted-foreground/55">消息</span>
              <span className="text-foreground/85">{session.messageCount}</span>
            </div>
          </div>

          {lifecycleBits.length > 0 && (
            <div className="mt-1 font-mono text-[10px] text-warning">
              {lifecycleBits.join(" · ")}
            </div>
          )}

          <div className="mt-2 flex items-center gap-1.5 border-t border-border/40 pt-1.5">
            <Button
              size="sm"
              className="h-6 text-[10.5px]"
              onClick={() => {
                window.alert(
                  `进入对话 ${session.title}（demo 占位）`
                );
              }}
            >
              <MessageSquare className="h-3 w-3" />
              进入对话
            </Button>
            {session.status === "ask_user" && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10.5px] text-warning"
              >
                <Hand className="h-3 w-3" />
                介入回答
              </Button>
            )}
            {session.status === "running" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10.5px] text-warning hover:bg-warning/10"
              >
                <Square className="h-3 w-3" />
                取消
              </Button>
            )}
            {session.status === "failed" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10.5px] text-accent hover:bg-accent/10"
              >
                <RotateCcw className="h-3 w-3" />
                重试
              </Button>
            )}
            <span className="ml-auto font-mono text-[10px] text-muted-foreground/55">
              externalRef {session.externalRef}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}