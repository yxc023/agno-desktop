import { useMemo, useState } from "react";
import {
  MessageSquare,
  ArrowRight,
  StickyNote,
  Send,
  CornerDownRight,
  CheckCircle2,
  Circle,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, formatRelativeTime, formatTime } from "@/lib/utils";
import type {
  Activity,
  AgentPlatform,
  AuthorType,
  CommentActivity,
  Requirement,
  StageTransitionActivity,
} from "./types";
import { useRequirementsStore } from "@/stores/requirements-store";
import { AuthorChip, PlatformBadge } from "./badges";
import { stageLabelCN } from "./selectors";

type Filter = "all" | "comment" | "stage-transition" | "agent-note";

const FILTER_TABS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "comment", label: "评论" },
  { value: "stage-transition", label: "stage" },
  { value: "agent-note", label: "note" },
];

interface ActivityTabProps {
  requirement: Requirement;
}

function findSessionTitle(req: Requirement, ref?: string): string | undefined {
  if (!ref) return undefined;
  return req.sessions.find((s) => s.id === ref)?.title;
}

export function ActivityTab({ requirement }: ActivityTabProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [composeOpen, setComposeOpen] = useState(false);

  const filtered = useMemo(() => {
    const list =
      filter === "all"
        ? requirement.activities
        : requirement.activities.filter((a) => a.kind === filter);
    return [...list].sort((a, b) => b.at - a.at);
  }, [requirement.activities, filter]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: requirement.activities.length };
    for (const a of requirement.activities) {
      m[a.kind] = (m[a.kind] ?? 0) + 1;
    }
    return m;
  }, [requirement.activities]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-5 py-2.5">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="h-7 bg-transparent p-0">
            {FILTER_TABS.map((f) => (
              <TabsTrigger
                key={f.value}
                value={f.value}
                className="h-6 rounded-md px-2 font-mono text-[10.5px] data-[state=active]:bg-sidebar-accent data-[state=active]:shadow-none data-[state=active]:text-foreground"
              >
                {f.label}
                {(counts[f.value] ?? 0) > 0 && (
                  <span className="ml-1 text-muted-foreground/55">
                    {counts[f.value]}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10.5px]"
          onClick={() => setComposeOpen(!composeOpen)}
        >
          <Plus className="h-3 w-3" />
          写评论
        </Button>
      </div>

      {composeOpen && (
        <ComposeComment
          requirement={requirement}
          onClose={() => setComposeOpen(false)}
        />
      )}

      <ScrollArea className="flex-1">
        <div className="px-3 py-3">
          {filtered.length === 0 && (
            <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-3 py-8 text-center font-mono text-[10.5px] text-muted-foreground/50">
              该需求暂无此类型的活动
            </div>
          )}

          <div className="space-y-2.5">
            {filtered.map((a) => (
              <TimelineRow key={a.id} activity={a}>
                <ActivityItem activity={a} requirement={requirement} />
              </TimelineRow>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function TimelineRow({
  activity,
  children,
}: {
  activity: Activity;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      {/* 时间列：右对齐，固定宽让右侧边框对齐 */}
      <div className="w-16 shrink-0 text-right font-mono leading-tight">
        <div className="whitespace-nowrap text-[10px] font-medium text-foreground/85">
          {formatTime(activity.at)}
        </div>
        <div className="whitespace-nowrap text-[9.5px] text-muted-foreground/55">
          {formatRelativeTime(activity.at)}
        </div>
      </div>

      {/* 内容列 */}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function ActivityItem({
  activity,
  requirement,
}: {
  activity: Activity;
  requirement: Requirement;
}) {
  switch (activity.kind) {
    case "comment":
      return <CommentRow activity={activity} requirement={requirement} />;
    case "stage-transition":
      return <StageTransitionRow activity={activity} requirement={requirement} />;
    case "agent-note":
      return <AgentNoteRow activity={activity} requirement={requirement} />;
  }
}

function CommentRow({
  activity,
  requirement,
}: {
  activity: CommentActivity;
  requirement: Requirement;
}) {
  const toggleResolve = useRequirementsStore((s) => s.toggleResolveComment);
  const addComment = useRequirementsStore((s) => s.addComment);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const isReply = !!activity.parentId;
  const isHuman = activity.authorType === "human";
  const sessionTitle = findSessionTitle(requirement, activity.sessionRef);

  return (
    <div
      className={cn(
        "group rounded-md border bg-card/40 px-3 py-2 transition-all hover:border-border",
        isReply && "ml-6 border-l-2 border-l-info/40 bg-info/[0.02]",
        isHuman ? "border-border/60" : "border-accent/30",
        activity.resolved && "opacity-60"
      )}
    >
      <div className="flex items-start gap-2">
        <MessageSquare
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0",
            isHuman ? "text-info" : "text-accent"
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <AuthorChip
              type={activity.authorType}
              name={activity.authorName}
              platform={activity.authorPlatform}
            />
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-foreground/90">
            {activity.content}
          </p>
          <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground/55">
            {!isHuman && sessionTitle && (
              <span className="inline-flex items-center gap-1 text-accent/85">
                <CornerDownRight className="h-2.5 w-2.5" />
                from{" "}
                <span className="font-medium text-foreground/85">
                  {sessionTitle}
                </span>
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
              {!isReply && (
                <button
                  type="button"
                  onClick={() => setReplyOpen(!replyOpen)}
                  className="font-mono text-[10px] text-muted-foreground/65 hover:text-foreground"
                >
                  回复
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleResolve(requirement.id, activity.id)}
                className="font-mono text-[10px] text-muted-foreground/65 hover:text-foreground"
              >
                {activity.resolved ? (
                  <>
                    <Circle className="mr-0.5 inline h-2.5 w-2.5" />
                    重开
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-0.5 inline h-2.5 w-2.5" />
                    标记解决
                  </>
                )}
              </button>
            </div>
          </div>
          {replyOpen && (
            <div className="mt-2 space-y-1.5">
              <Input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="回复…"
                className="h-7 text-[11px]"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && replyText.trim()) {
                    addComment(requirement.id, {
                      content: replyText.trim(),
                      authorType: "agent",
                      authorName: "opencode",
                      authorPlatform: "opencode",
                      parentId: activity.id,
                    });
                    setReplyText("");
                    setReplyOpen(false);
                  }
                  if (e.key === "Escape") setReplyOpen(false);
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StageTransitionRow({
  activity,
  requirement,
}: {
  activity: StageTransitionActivity;
  requirement: Requirement;
}) {
  const isAgent = activity.authorType === "agent";
  const sessionTitle = findSessionTitle(requirement, activity.sessionRef);

  return (
    <div className="rounded-md border border-info/30 bg-info/[0.04] px-3 py-2">
      <div className="flex items-center gap-2">
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-info" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-info/85">
          stage
        </span>
        <span className="font-mono text-[11px] text-muted-foreground/75">
          {activity.fromStage ?? "init"}
        </span>
        <span className="text-muted-foreground/40">→</span>
        <span className="font-mono text-[11px] font-medium text-foreground/95">
          {activity.toStage}
        </span>
        <span className="text-[11px] text-muted-foreground/70">
          · {stageLabelCN(activity.toStage)}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <AuthorChip
            type={activity.authorType}
            name={activity.authorName}
            platform={activity.authorPlatform}
          />
        </span>
      </div>
      {activity.reason && (
        <div className="mt-1.5 ml-5 rounded-md border border-info/15 bg-background/50 px-2.5 py-1.5 text-[11.5px] italic text-foreground/85">
          "{activity.reason}"
        </div>
      )}
      {isAgent && sessionTitle && (
        <div className="ml-5 mt-1 font-mono text-[10px] text-muted-foreground/65">
          ↳ 触发 session:{" "}
          <span className="text-foreground/85">{sessionTitle}</span>
        </div>
      )}
    </div>
  );
}

function AgentNoteRow({
  activity,
  requirement,
}: {
  activity: Extract<Activity, { kind: "agent-note" }>;
  requirement: Requirement;
}) {
  const sessionTitle = findSessionTitle(requirement, activity.sessionRef);
  return (
    <div className="rounded-md border border-accent/25 bg-accent/[0.03] px-3 py-2">
      <div className="flex items-start gap-2">
        <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <AuthorChip
              type={activity.authorType}
              name={activity.authorName}
              platform={activity.authorPlatform}
            />
            <span className="font-mono text-[10px] text-muted-foreground/55">
              · note
            </span>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-foreground/90">
            {activity.content}
          </p>
          {sessionTitle && (
            <div className="mt-1 font-mono text-[10px] text-muted-foreground/65">
              ↳ from session{" "}
              <span className="text-foreground/85">{sessionTitle}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ComposeComment({
  requirement,
  onClose,
}: {
  requirement: Requirement;
  onClose: () => void;
}) {
  const addComment = useRequirementsStore((s) => s.addComment);
  const [text, setText] = useState("");

  function defaultActor(): {
    name: string;
    type: AuthorType;
    platform?: AgentPlatform;
  } {
    if (requirement.id === "REQ-198") return { name: "Bob", type: "human" };
    if (requirement.id === "REQ-205") return { name: "Carol", type: "human" };
    return { name: "Alice", type: "human" };
  }
  const actor = defaultActor();

  function handleSubmit() {
    if (!text.trim()) return;
    addComment(requirement.id, {
      content: text.trim(),
      authorType: actor.type,
      authorName: actor.name,
      authorPlatform: actor.platform,
    });
    setText("");
    onClose();
  }

  return (
    <div className="shrink-0 border-b border-sidebar-border bg-muted/30 px-5 py-3">
      <div className="flex items-start gap-2">
        <PlatformBadge
          platform={
            (actor.platform ??
              (actor.type === "agent" ? "opencode" : "opencode")) as
              | "agno"
              | "claude-code"
              | "opencode"
              | "codex"
          }
          size="sm"
        />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`以 ${actor.name} 身份写评论…`}
          autoFocus
          className="h-8 text-[11.5px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
            if (e.key === "Escape") onClose();
          }}
        />
        <Button
          size="sm"
          className="h-8"
          disabled={!text.trim()}
          onClick={handleSubmit}
        >
          <Send className="h-3 w-3" />
          发送
        </Button>
      </div>
    </div>
  );
}