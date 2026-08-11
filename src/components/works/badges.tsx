import { Bot, User, Bot as BotIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentPlatform, AuthorType } from "./types";
import { platformColor, platformLabelCN } from "./selectors";

interface PlatformBadgeProps {
  platform: Exclude<AgentPlatform, "human">;
  className?: string;
  size?: "sm" | "md";
}

export function PlatformBadge({ platform, className, size = "md" }: PlatformBadgeProps) {
  const c = platformColor(platform);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-mono uppercase tracking-wider",
        c.border,
        c.bg,
        c.fg,
        size === "sm" ? "px-1 py-px text-[9px]" : "px-1.5 py-0.5 text-[10px]",
        className
      )}
    >
      <Bot className={size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5"} />
      {platformLabelCN(platform)}
    </span>
  );
}

interface AuthorChipProps {
  type: AuthorType;
  name: string;
  platform?: AgentPlatform;
  avatar?: string;
  className?: string;
}

export function AuthorChip({ type, name, platform, avatar, className }: AuthorChipProps) {
  const isHuman = type === "human";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px]",
        isHuman
          ? "border-foreground/20 bg-foreground/[0.06] text-foreground/85"
          : "border-accent/30 bg-accent/10 text-accent",
        className
      )}
    >
      {isHuman ? (
        avatar ? (
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-accent/30 font-mono text-[9px] font-semibold text-accent-foreground">
            {avatar}
          </span>
        ) : (
          <User className="h-2.5 w-2.5" />
        )
      ) : (
        <BotIcon className="h-2.5 w-2.5" />
      )}
      <span className="font-medium">{name}</span>
      {!isHuman && platform && (
        <span className="font-mono text-[9px] opacity-70">· {platformLabelCN(platform)}</span>
      )}
    </span>
  );
}

interface StageBadgeProps {
  kind: "plan" | "do" | "check" | "deliver";
  status: "pending" | "active" | "done";
  className?: string;
}

const STAGE_CN: Record<StageBadgeProps["kind"], string> = {
  plan: "计划",
  do: "执行",
  check: "检查",
  deliver: "交付",
};

export function StageBadge({ kind, status, className }: StageBadgeProps) {
  const variant =
    status === "active"
      ? "border-accent/50 bg-accent/15 text-accent"
      : status === "done"
      ? "border-success/40 bg-success/10 text-success"
      : "border-border bg-muted/40 text-muted-foreground/70";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] tracking-wider",
        variant,
        className
      )}
    >
      <span className="font-semibold">{kind}</span>
      <span className="opacity-60">·</span>
      <span>{STAGE_CN[kind]}</span>
    </span>
  );
}