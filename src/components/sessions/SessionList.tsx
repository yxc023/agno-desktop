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
  Copy,
  Check,
  ChevronDown,
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
import { cn, copyToClipboard, formatRelativeTime, truncate } from "@/lib/utils";
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

/**
 * 把 session id 折成"前 8 + … + 后 4"的形式，保留前缀（通常带时间/实例信息）
 * 和后缀（通常带随机数）便于肉眼对照完整 id。
 * id 太短则原样返回。
 */
function shortSessionId(id: string): string {
  if (!id) return "";
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function SessionList() {
  const active = useActiveInstance();
  const loadSessions = useSessionsStore((s) => s.loadSessions);
  const loadMoreSessions = useSessionsStore((s) => s.loadMoreSessions);
  const loading = useSessionsStore((s) => s.loading);
  const loadingMore = useSessionsStore((s) => s.loadingMore);
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
  const pagination = useSessionsStore((s) =>
    active ? s.pagination[active.id] ?? null : null
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
                {pagination?.totalCount
                  ? `${sessions.length}/${pagination.totalCount}`
                  : sessions.length}
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
        {/*
         * min-w-0 + overflow-hidden：内部 div 必须在 Viewport (259px) 内。
         * 否则长 title 撑出来的 SessionItem 会把 inner div 撑到 540+px，
         * 用户看到的是 viewport overflow-x: hidden 截断后的"突兀贴边"。
         * overflow-hidden 是真正的杀手锏 —— 阻止 SessionItem 的 min-content
         * 把 inner div 反向撑大。
         */}
        <div
          className="min-w-0 space-y-0.5 overflow-hidden p-1.5"
        >
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
              onCopyId={async () => {
                await copyToClipboard(s.session_id);
              }}
            />
          ))}

          {/* "加载更多" —— 仅在确实还有剩余时显示。
              不在搜索时显示：搜索过滤的是已加载列表，再加载更多也不一定命中，
              会给用户"为什么搜不到"的错觉。 */}
          {!searchQuery.trim() &&
            pagination?.hasMore &&
            pagination.totalCount > 0 && (
              <div className="pt-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => active && loadMoreSessions(active.id)}
                  className="w-full h-7 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                      加载中…
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3 mr-1" />
                      加载更多
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/60">
                        {sessions.length} / {pagination.totalCount}
                      </span>
                    </>
                  )}
                </Button>
              </div>
            )}

          {/* 已加载全部时的轻量反馈：避免用户怀疑"是不是漏了"。仅在没在搜索时显示。 */}
          {!searchQuery.trim() &&
            pagination &&
            !pagination.hasMore &&
            pagination.totalCount > 0 &&
            sessions.length > 0 && (
              <div className="pt-1.5 pb-1 text-center font-mono text-[10px] text-muted-foreground/50">
                — 全部 {pagination.totalCount} 条已加载 —
              </div>
            )}
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
  onCopyId,
}: {
  session: AgSessionSummary;
  index: number;
  active: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: () => void;
  onCopyId: () => void;
}) {
  const title =
    session.session_name ||
    session.session_summary ||
    truncate(session.session_id, 20);

  const preview =
    session.last_message_preview ||
    (session.session_summary ? "" : `Agent: ${session.agent_id ?? "—"}`);

  // 复制 session id 的瞬态反馈：
  // - 默认显示 "#abc1…xyz9"（短 id）
  // - hover 整行时变深 + 出现 Copy icon，提示"这一段可点"
  // - 点击复制，icon 短暂变成 Check + success 色，1.5s 后复位
  // 状态放在 item 内部而不是 store——copied 是纯 UI 反馈，
  // 跟"哪个 session 处于已复制状态"的业务无关；放外层会引入额外 selector。
  const [idCopied, setIdCopied] = useState(false);

  async function handleCopyId(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    onCopyId();
    setIdCopied(true);
    setTimeout(() => setIdCopied(false), 1500);
  }

  return (
    <div
      onClick={onClick}
      style={{ animationDelay: `${Math.min(index * 30, 300)}ms` }}
      className={cn(
        // min-w-0 + overflow-hidden 双重保险：父容器是 ScrollArea Viewport，
        // 宽度受 aside (260px) 约束。SessionItem 在 flex column 里默认
        // min-width: auto，意味着会按内容撑到 "长 title + dropdown + padding" 的
        // 自然宽度，可能超过 260px 让右侧 dropdown 跑到 aside 外被 viewport
        // overflow-x: hidden 截掉——长名字 truncate 后 ellipsis 紧贴右边框
        // 就是这个布局 bug 的视觉表现。min-w-0 让 item 跟随父容器宽度，
        // overflow-hidden 兜底任何内部的溢出。
        "group relative min-w-0 cursor-pointer animate-fade-in overflow-hidden rounded-md px-2.5 py-2 transition-all",
        active
          ? "bg-sidebar-accent"
          : "hover:bg-sidebar-accent/50"
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-accent" />
      )}
      <div className="flex items-start justify-between gap-2">
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
          {/*
           * Session id 行：始终可见（淡灰 mono），hover 时变深 + 出现 Copy icon。
           * - title 属性挂完整 id，悬停 1s+ 浏览器会显示原生 tooltip
           *   （避免再单独引一个 tooltip 组件增加依赖）。
           * - 整个 button 是一个可点击单元，stopPropagation 阻止冒泡到
           *   外层 div 的"切换 session"逻辑。
           * - 截短形式 "前 8…后 4" 保留前缀（uuid/时间相关）+ 后缀（随机数），
           *   比单截前面更便于肉眼对完整 id。
           * - 复制成功后 icon 切到 Check 1.5s，提供明确的"已发生"反馈。
           */}
          <button
            type="button"
            onClick={handleCopyId}
            title={session.session_id}
            aria-label="复制 session id"
            className={cn(
              "mt-1 flex w-fit max-w-full items-center gap-1 rounded px-1 -mx-1 font-mono text-[10px] transition-colors",
              "text-muted-foreground/50 hover:bg-foreground/[0.06] hover:text-muted-foreground",
              idCopied && "text-success"
            )}
          >
            <span className="truncate">#{shortSessionId(session.session_id)}</span>
            {idCopied ? (
              <Check className="h-2.5 w-2.5 shrink-0" />
            ) : (
              <Copy className="h-2.5 w-2.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
            )}
          </button>
        </div>

        {/*
         * 右侧 dropdown 按钮始终保留可见（低不透明 /35 默认，hover / group-hover
         * 时变深）。原来用 text-muted-foreground/0 完全透明，结果就是：
         * - 用户没意识到这一行可以点出菜单
         * - 长名字 truncate 后视觉上是 "text + 24px 空隙 + border"，缺一个
         *   affordance 把空隙"解释"掉，看着很生硬
         *
         * 现在按钮默认就是淡淡可见的 3 个点，相当于在右侧充当"占位 + 提示"
         * 的角色，长名字 truncate 后视觉链路变成 "text + 4px gap + ⋯ + border"，
         * 整体感觉是「这是被截断了，后面还有操作」，而不是「突兀地切了」。
         */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={(e) => e.stopPropagation()}
              aria-label="会话操作"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/40 transition-all hover:bg-foreground/10 hover:text-foreground group-hover:text-muted-foreground"
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation();
                onCopyId();
              }}
            >
              <Copy className="h-3 w-3 mr-2" />
              复制 Session ID
            </DropdownMenuItem>
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