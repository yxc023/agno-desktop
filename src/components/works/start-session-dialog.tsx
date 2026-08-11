import { useMemo, useState } from "react";
import { Play, Sparkles, Plus, Check, Users, Bot } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AgentPlatform, Requirement } from "./types";
import { PlatformBadge } from "./badges";
import { platformColor, stageDefinition } from "./selectors";

interface StartSessionDialogProps {
  requirement: Requirement;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

interface AgentOption {
  name: string;
  platform: AgentPlatform;
  /** 来自 req.assignees 还是 stage suggested */
  source: "assignee" | "suggested";
}

function dedupeAgents(agents: AgentOption[]): AgentOption[] {
  const seen = new Set<string>();
  const out: AgentOption[] = [];
  for (const a of agents) {
    const key = `${a.platform}::${a.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

export function StartSessionDialog({
  requirement,
  open,
  onOpenChange,
}: StartSessionDialogProps) {
  const def = stageDefinition(requirement.currentStage);

  const suggested: AgentOption[] = useMemo(() => {
    return dedupeAgents(
      def.suggestedAgents.map((a) => ({
        name: a.name,
        platform: a.platform,
        source: "suggested" as const,
      }))
    );
  }, [def]);

  const fromAssignees: AgentOption[] = useMemo(() => {
    const list: AgentOption[] = [];
    for (const a of requirement.assignees) {
      if (a.kind !== "agent" || !a.platform) continue;
      list.push({ name: a.name, platform: a.platform, source: "assignee" });
    }
    return dedupeAgents(list);
  }, [requirement.assignees]);

  const all = useMemo(
    () => dedupeAgents([...suggested, ...fromAssignees]),
    [suggested, fromAssignees]
  );
  void all;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");

  function toggleAgent(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function reset() {
    setSelected(new Set());
    setMessage("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[14px]">
            <Play className="h-3.5 w-3.5 text-accent" />
            启动工作会话
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px]">
            为本需求发起一个 session；选 1+ 预制 agent 进入会话。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5 pt-1">
          <div className="rounded-md border border-accent/30 bg-accent/[0.05] px-3 py-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-accent/80">
              requirement (locked)
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-[11.5px] font-medium text-foreground/90">
                {requirement.id}
              </span>
              <span className="truncate text-[12px] text-foreground/85">
                {requirement.title}
              </span>
            </div>
            <div className="mt-1 font-mono text-[10px] text-muted-foreground/65">
              current stage:{" "}
              <span className="font-medium text-accent">
                {requirement.currentStage}
              </span>
              <span className="ml-1 text-muted-foreground/55">
                · 建议 agent: {def.suggestedAgents.map((a) => a.name).join(", ")}
              </span>
            </div>
          </div>

          {suggested.length > 0 && (
            <AgentPickerGroup
              label="suggested by stage"
              icon={<Sparkles className="h-3 w-3 text-accent" />}
              agents={suggested}
              selected={selected}
              onToggle={toggleAgent}
              recommended
            />
          )}

          {fromAssignees.length > 0 && (
            <AgentPickerGroup
              label="from assignees"
              icon={<Users className="h-3 w-3 text-info" />}
              agents={fromAssignees}
              selected={selected}
              onToggle={toggleAgent}
            />
          )}

          <div>
            <Label
              htmlFor="ws-msg"
              className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70"
            >
              初始消息
            </Label>
            <Input
              id="ws-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="例：继续完成 sampling edge 的 fallback 分支"
              className="mt-1.5 font-mono text-[11.5px]"
            />
          </div>

          <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 font-mono text-[10.5px] text-muted-foreground/75">
            <div className="flex items-center gap-1.5">
              <Bot className="h-2.5 w-2.5 text-info" />
              <span className="text-foreground/85">binding preview</span>
            </div>
            <div className="mt-1.5 space-y-0.5 text-muted-foreground/65">
              <div>
                externalRef →{" "}
                <span className="text-foreground/90">
                  cc-{Math.random().toString(36).slice(2, 8)}
                </span>
              </div>
              <div>
                requirementId →{" "}
                <span className="text-foreground/90">{requirement.id}</span>
              </div>
              <div className="text-muted-foreground/55">
                participants →{" "}
                {selected.size === 0 ? (
                  <span className="text-muted-foreground/70">— 暂未选择 —</span>
                ) : (
                  <span className="text-foreground/90">
                    {[...selected]
                      .map((k) => k.split("::")[1])
                      .join(" · ")}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled title="demo: 实际启动占位">
            <Play className="h-3 w-3" />
            启动并打开
            {selected.size > 0 && (
              <span className="ml-1 rounded bg-primary-foreground/15 px-1.5 py-px font-mono text-[10px]">
                {selected.size}
              </span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentPickerGroup({
  label,
  icon,
  agents,
  selected,
  onToggle,
  recommended,
}: {
  label: string;
  icon: React.ReactNode;
  agents: AgentOption[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  recommended?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/65">
        {icon}
        <span>{label}</span>
        <span className="text-muted-foreground/40">·</span>
        <span>{agents.length}</span>
        {recommended && (
          <span className="ml-1 rounded border border-accent/40 bg-accent/10 px-1 font-mono text-[9px] text-accent">
            recommended
          </span>
        )}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {agents.map((a) => {
          const key = `${a.platform}::${a.name}`;
          const isSelected = selected.has(key);
          const color = platformColor(a.platform);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggle(key)}
              className={cn(
                "group flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-all",
                isSelected
                  ? `${color.border} ${color.bg}`
                  : "border-border/60 bg-card/40 hover:border-border"
              )}
            >
              <PlatformBadge
                platform={a.platform as "agno" | "claude-code" | "opencode" | "codex"}
                size="sm"
              />
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/90">
                {a.name}
              </span>
              {isSelected ? (
                <Check className={cn("h-3 w-3 shrink-0", color.fg)} />
              ) : (
                <Plus className="h-3 w-3 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground/80" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}