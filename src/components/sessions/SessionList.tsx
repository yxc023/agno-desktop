import { useEffect, useState } from "react";
import {
  Search,
  Plus,
  MoreHorizontal,
  Trash2,
  Pencil,
  MessageSquare,
  Loader2,
  Command,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatRelativeTime, truncate } from "@/lib/utils";
import { useActiveInstance, useInstancesStore } from "@/stores/instances-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useChatStore } from "@/stores/chat-store";
import type { AgSessionSummary } from "@/lib/agno-types";
import { Terminal } from "lucide-react";

const EMPTY_ARR: AgSessionSummary[] = [];

function formatSessionTime(input: number | string | undefined | null): string {
  if (!input) return "—";
  let date: Date;
  if (typeof input === "number") {
    date = input > 1e12 ? new Date(input) : new Date(input * 1000);
  } else if (typeof input === "string") {
    const asNum = Number(input);
    if (!isNaN(asNum) && asNum > 0) {
      date = asNum > 1e12 ? new Date(asNum) : new Date(asNum * 1000);
    } else {
      date = new Date(input);
    }
  } else {
    return "—";
  }
  if (isNaN(date.getTime())) return "—";
  return formatRelativeTime(date);
}

export function SessionList() {
  const active = useActiveInstance();
  const loadSessions = useSessionsStore((s) => s.loadSessions);
  const loading = useSessionsStore((s) => s.loading);
  const searchQuery = useSessionsStore((s) => s.searchQuery);
  const setSearchQuery = useSessionsStore((s) => s.setSearchQuery);
  const currentSessionId = useSessionsStore((s) => s.currentSessionId);
  const loadError = useSessionsStore((s) =>
    active ? s.loadError[active.id] ?? null : null
  );
  const setCurrentSession = useSessionsStore((s) => s.setCurrentSession);
  const removeSession = useSessionsStore((s) => s.removeSession);
  const renameSession = useSessionsStore((s) => s.renameSession);
  const sessions = useSessionsStore((s) =>
    active ? (s.byInstance[active.id] ?? EMPTY_ARR) : EMPTY_ARR
  );
  const newSession = useChatStore((s) => s.newSession);

  const [renameTarget, setRenameTarget] = useState<AgSessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    if (active) loadSessions(active.id);
  }, [active, loadSessions]);

  const filtered = searchQuery.trim()
    ? sessions.filter((s: AgSessionSummary) =>
        [
          s.session_name,
          s.session_id,
          s.session_summary,
          s.last_message_preview,
          s.agent_id,
        ]
          .filter(Boolean)
          .some((v) =>
            String(v).toLowerCase().includes(searchQuery.toLowerCase())
          )
      )
    : sessions;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="space-y-2.5 border-b border-sidebar-border px-3 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[12px] font-medium">会话</span>
            {sessions.length > 0 && (
              <span className="font-mono text-[10px] text-muted-foreground/70">
                {sessions.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => newSession()}
              title="新建会话 (⌘N)"
              className="h-6 w-6"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="命令面板 (⌘K)"
              className="h-6 w-6"
              disabled
            >
              <Command className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索会话..."
            className="h-7 pl-7 font-mono text-[11px]"
          />
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-1.5">
          {loadError && (
            <div className="m-1.5 space-y-1.5 rounded-md border border-destructive/40 bg-destructive/[0.04] p-2.5">
              <div className="flex items-start gap-1.5 font-mono text-[10.5px] text-destructive">
                <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                <div className="flex-1 break-all whitespace-pre-line">
                  <div className="font-medium">会话加载失败</div>
                  <div className="text-destructive/80 mt-0.5">
                    {loadError}
                  </div>
                </div>
              </div>
              {loadError.includes("CORS") &&
                active &&
                /^https?:\/\//i.test(active.baseUrl) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (!active) return;
                      const id = active.id;
                      useInstancesStore
                        .getState()
                        .updateInstance(id, { baseUrl: "/api" });
                      setTimeout(() => {
                        useInstancesStore.getState().probeInstance(id);
                        useInstancesStore
                          .getState()
                          .loadAgents(id, true);
                        loadSessions(id, true);
                      }, 100);
                    }}
                    className="h-6 w-full border-accent/40 text-[10.5px] text-accent"
                  >
                    <Terminal className="h-3 w-3 mr-1" />
                    一键改用 /api
                  </Button>
                )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => active && loadSessions(active.id, true)}
                className="h-6 w-full text-[10.5px]"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                重试
              </Button>
            </div>
          )}

          {loading && sessions.length === 0 && (
            <div className="space-y-1 px-1.5 py-1">
              <Skeleton className="h-12 w-full rounded-md" />
              <Skeleton className="h-12 w-full rounded-md" />
              <Skeleton className="h-12 w-full rounded-md" />
            </div>
          )}

          {!loading && !loadError && sessions.length === 0 && (
            <div className="px-3 py-12 text-center">
              <div className="mx-auto mb-3 flex h-8 w-8 items-center justify-center rounded-md bg-muted/50 text-muted-foreground/50">
                <MessageSquare className="h-4 w-4" />
              </div>
              <p className="text-[12px] text-muted-foreground">暂无会话</p>
              <p className="mt-1 font-mono text-[10.5px] text-muted-foreground/60">
                按 ⌘N 新建
              </p>
            </div>
          )}

          {filtered.map((s, i) => (
            <SessionItem
              key={s.session_id}
              session={s}
              index={i}
              active={currentSessionId === s.session_id}
              onClick={() => setCurrentSession(s.session_id)}
              onDelete={() => {
                if (confirm(`确定删除会话「${s.session_name ?? s.session_id}」？`)) {
                  if (active) removeSession(active.id, s.session_id);
                }
              }}
              onRename={() => {
                setRenameTarget(s);
                setRenameValue(s.session_name ?? "");
              }}
            />
          ))}
        </div>
      </ScrollArea>

      {renameTarget && active && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-sm">
          <div className="w-80 space-y-3 rounded-lg border bg-card p-4 shadow-xl">
            <div className="text-[13px] font-medium">重命名会话</div>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  renameSession(active.id, renameTarget.session_id, renameValue);
                  setRenameTarget(null);
                }
                if (e.key === "Escape") setRenameTarget(null);
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRenameTarget(null)}>
                取消
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  renameSession(active.id, renameTarget.session_id, renameValue);
                  setRenameTarget(null);
                }}
              >
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SessionItem({
  session,
  index,
  active,
  onClick,
  onDelete,
  onRename,
}: {
  session: AgSessionSummary;
  index: number;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: () => void;
}) {
  const title =
    session.session_name ||
    session.session_summary ||
    truncate(session.session_id, 20);

  const preview =
    session.last_message_preview ||
    (session.session_summary ? "" : `Agent: ${session.agent_id ?? "—"}`);

  return (
    <div
      onClick={onClick}
      style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
      className={cn(
        "group relative cursor-pointer animate-fade-in rounded-md px-2.5 py-2 transition-all",
        active
          ? "bg-sidebar-accent"
          : "hover:bg-sidebar-accent/50"
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-accent" />
      )}
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "truncate text-[12.5px]",
              active ? "font-medium" : "font-normal"
            )}
          >
            {title}
          </div>
          {preview && (
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
              {truncate(preview, 50)}
            </div>
          )}
          <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground/60">
            {session.session_type && (
              <span className="uppercase tracking-wider">
                {session.session_type}
              </span>
            )}
            {session.updated_at && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span>{formatSessionTime(session.updated_at)}</span>
              </>
            )}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/0 transition-all hover:bg-foreground/10 hover:text-muted-foreground group-hover:text-muted-foreground/60"
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="h-3 w-3 mr-2" />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-destructive">
              <Trash2 className="h-3 w-3 mr-2" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}