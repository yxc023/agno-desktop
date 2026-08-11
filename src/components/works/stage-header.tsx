import { useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  Play,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { Requirement, StageKind } from "./types";
import { stageLabelCN } from "./selectors";
import { useRequirementsStore } from "@/stores/requirements-store";

interface StageHeaderProps {
  requirement: Requirement;
}

export function StageHeader({ requirement }: StageHeaderProps) {
  const transitionStage = useRequirementsStore((s) => s.transitionStage);
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [targetStage, setTargetStage] = useState<StageKind | null>(null);
  const [reason, setReason] = useState("");
  const [actor, setActor] = useState<"Alice" | "Bob" | "Carol">(() => {
    if (requirement.id === "REQ-198") return "Bob";
    if (requirement.id === "REQ-205") return "Carol";
    return "Alice";
  });

  const transitions = requirement.activities.filter(
    (a) => a.kind === "stage-transition"
  );

  function handleConfirm() {
    if (!targetStage || targetStage === requirement.currentStage) return;
    transitionStage(requirement.id, {
      toStage: targetStage,
      actorType: "human",
      actorName: actor,
      reason: reason.trim() || undefined,
    });
    setOpen(false);
    setTargetStage(null);
    setReason("");
  }

  return (
    <div className="rounded-md border border-accent/30 bg-accent/[0.04] px-3 py-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
              current stage
            </span>
            <span className="font-mono text-[12px] font-semibold text-accent">
              {requirement.currentStage}
            </span>
            <span className="text-[11.5px] text-foreground/90">
              · {stageLabelCN(requirement.currentStage)}
            </span>
            <button
              type="button"
              onClick={() => setHistoryOpen(!historyOpen)}
              className="ml-auto font-mono text-[10px] text-muted-foreground/65 underline-offset-2 hover:underline"
            >
              <History className="mr-1 inline h-3 w-3" />
              history · {transitions.length}
            </button>
          </div>

          {historyOpen && transitions.length > 0 && (
            <ol className="mt-2 space-y-1 border-t border-border/40 pt-2">
              {transitions.slice(0, 4).map((t) => {
                if (t.kind !== "stage-transition") return null;
                return (
                  <li
                    key={t.id}
                    className="flex items-baseline gap-2 font-mono text-[10px] text-muted-foreground/75"
                  >
                    <ArrowRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/55" />
                    <span className="text-muted-foreground/65">
                      {t.fromStage ?? "init"}
                    </span>
                    <span className="text-muted-foreground/40">→</span>
                    <span className="font-medium text-foreground/85">
                      {t.toStage}
                    </span>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{t.authorName}</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{formatRelativeTime(t.at)}</span>
                    {t.reason && (
                      <span className="ml-1 truncate text-muted-foreground/60">
                        "{t.reason}"
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-7 shrink-0 text-[11px]"
          onClick={() => setOpen(!open)}
        >
          推进 stage
          <ChevronDown className="h-3 w-3" />
        </Button>
      </div>

      {open && (
        <div className="mt-3 space-y-2.5 rounded-md border border-border bg-background/80 p-3">
          <div className="grid grid-cols-4 gap-1.5">
            {(["plan", "do", "check", "deliver"] as StageKind[]).map((k) => {
              const isCurrent = k === requirement.currentStage;
              const isSelected = targetStage === k;
              return (
                <button
                  key={k}
                  type="button"
                  disabled={isCurrent}
                  onClick={() => setTargetStage(k)}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left text-[11px] transition-all",
                    isCurrent && "cursor-default border-success/40 bg-success/[0.06] text-success",
                    !isCurrent && isSelected && "border-accent/50 bg-accent/[0.08] text-foreground",
                    !isCurrent && !isSelected && "border-border/60 bg-card/40 text-muted-foreground hover:border-border"
                  )}
                >
                  <span className="font-mono text-[10px] uppercase tracking-wider">
                    {k}
                  </span>
                  <span className="text-[10px]">{stageLabelCN(k)}</span>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-2">
            <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/65">
              reason
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例：check 通过，进入交付"
              className="h-7 rounded-md border border-border bg-background px-2 text-[11px] text-foreground/90 placeholder:text-muted-foreground/40 focus:border-accent/50 focus:outline-none"
            />
            <label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/65">
              actor
            </label>
            <select
              value={actor}
              onChange={(e) => setActor(e.target.value as typeof actor)}
              className="h-7 rounded-md border border-border bg-background px-2 text-[11px] text-foreground/90 focus:border-accent/50 focus:outline-none"
            >
              <option value="Alice">Alice</option>
              <option value="Bob">Bob</option>
              <option value="Carol">Carol</option>
            </select>
          </div>
          <div className="flex items-center justify-end gap-1.5 pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => {
                setOpen(false);
                setTargetStage(null);
                setReason("");
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="h-7 text-[11px]"
              disabled={!targetStage || targetStage === requirement.currentStage}
              onClick={handleConfirm}
            >
              <Play className="h-3 w-3" />
              确认推进
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}