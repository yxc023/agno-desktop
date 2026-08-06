/**
 * AgentPicker — 紧凑的 agent 选择/锁定控件。
 *
 * 设计为「inline」渲染：返回 `flex items-center gap-2` 块，不带任何
 * 外框 / padding / max-width，caller 自己控制布局与位置。常驻位置：
 * MessageInput 底部那一行（与 user_id 同列）。
 *
 * 三种态：
 *   1. locked — 当前 session 已有 agent（AgSessionSummary.agent_id），
 *      显示成只读 badge，不允许换。理由：session 已经在某个 agent 下产
 *      生了 runs/memory，换 agent 会让后续 message 的归属和 context 都乱。
 *   2. selectable — 当前没有 session，或新建 session 路径（顶部 "new" 按钮）。
 *      渲染成 Select 下拉 + refresh icon。
 *   3. error/empty — 实例拉 agent 失败 / 没 agent：下拉内显示对应提示。
 *
 * 因为这里贴在底部一行里、可视高度有限，trigger 紧凑化：
 * - h-6（不是 h-7）
 * - min-w-[140px]（不是 200px，让出位置给 user_id）
 * - badge 紧凑，去掉 "agent locked" 副文案
 */

import { useMemo } from "react";
import {
  AlertCircle,
  Loader2,
  Lock,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  useActiveAgents,
  useActiveInstance,
  useIsLoadingAgents,
  useInstancesStore,
} from "@/stores/instances-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useChatStore } from "@/stores/chat-store";
import type { AgAgentResponse } from "@/lib/agno-types";

interface Props {
  className?: string;
}

export function AgentPicker({ className }: Props) {
  const active = useActiveInstance();
  const agents = useActiveAgents();
  const loadingAgents = useIsLoadingAgents();
  const probe = useInstancesStore((s) => s.probeInstance);
  const loadAgents = useInstancesStore((s) => s.loadAgents);

  const currentSessionId = useSessionsStore((s) => s.currentSessionId);
  const sessions = useSessionsStore((s) =>
    active ? s.byInstance[active.id] ?? [] : []
  );
  const currentSession = useMemo(
    () =>
      currentSessionId
        ? sessions.find((sess) => sess.session_id === currentSessionId) ?? null
        : null,
    [sessions, currentSessionId]
  );

  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const setSelectedAgent = useChatStore((s) => s.setSelectedAgent);

  if (!active) return null;

  // locked: session 已绑定 agent
  if (currentSession?.agent_id) {
    const lockedAgent =
      agents.find((a) => a.id === currentSession.agent_id) ?? null;
    return (
      <div
        className={cn(
          "inline-flex min-w-0 items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5",
          "font-mono text-[11px] text-muted-foreground/80",
          className
        )}
        title="已绑定的 session 无法切换 agent；如需换 agent 请新建会话"
      >
        <Lock className="h-2.5 w-2.5 shrink-0 opacity-70" />
        <span className="truncate font-medium text-foreground/90">
          {lockedAgent?.name ?? lockedAgent?.id ?? currentSession.agent_id}
        </span>
      </div>
    );
  }

  // 没有 session / 新会话路径：可选择
  const value = selectedAgentId ?? agents[0]?.id ?? "";
  const placeholder = loadingAgents
    ? "loading…"
    : agents.length === 0
      ? "暂无可用 agent"
      : "选择 Agent";

  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <Select
        value={value}
        onValueChange={(v) => setSelectedAgent(v)}
        disabled={loadingAgents || agents.length === 0}
      >
        <SelectTrigger
          className={cn(
            "h-6 min-w-0 max-w-full border-none bg-muted/40 px-2 shadow-none hover:bg-muted",
            "font-mono text-[11px]",
            "data-[disabled]:opacity-60"
          )}
        >
          {loadingAgents ? (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              <span className="truncate">{placeholder}</span>
            </span>
          ) : (
            <SelectValue placeholder={placeholder} />
          )}
        </SelectTrigger>
        <SelectContent>
          {loadingAgents && (
            <div className="flex items-center gap-2 px-2 py-3 font-mono text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              正在从实例拉取 agents...
            </div>
          )}

          {!loadingAgents && active.lastAgentsError && (
            <div className="space-y-2 px-2 py-2">
              <div className="flex items-start gap-1.5 font-mono text-[11px] text-destructive">
                <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                <div className="flex-1 break-all whitespace-pre-line">
                  <div className="font-medium">拉取失败</div>
                  <div className="text-destructive/80 text-[10px] mt-0.5">
                    {active.lastAgentsError}
                  </div>
                </div>
              </div>
              {active.lastAgentsError.includes("CORS") &&
                /^https?:\/\//i.test(active.baseUrl) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-full border-accent/40 text-accent"
                    onClick={() => {
                      const id = active.id;
                      useInstancesStore
                        .getState()
                        .updateInstance(id, { baseUrl: "/api" });
                      setTimeout(() => {
                        useInstancesStore.getState().probeInstance(id);
                        useInstancesStore.getState().loadAgents(id, true);
                      }, 100);
                    }}
                  >
                    <Terminal className="h-3 w-3 mr-1.5" />
                    一键改用 /api 代理
                  </Button>
                )}
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 flex-1 text-[11px]"
                  onClick={() => {
                    probe(active.id);
                    loadAgents(active.id, true);
                  }}
                >
                  <RefreshCw className="h-3 w-3 mr-1.5" />
                  重试
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  onClick={() => {
                    const docsBase =
                      active.baseUrl.replace(/\/api\/?$/, "") ||
                      active.baseUrl;
                    window.open(`${docsBase}/docs`, "_blank");
                  }}
                  title="查看 AGNO API 文档"
                >
                  <Terminal className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}

          {!loadingAgents &&
            !active.lastAgentsError &&
            agents.length === 0 && (
              <div className="space-y-2 px-2 py-3">
                <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                  <AlertCircle className="h-3 w-3 text-warning" />
                  当前实例未发现 agent
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-full text-[11px]"
                  onClick={() => loadAgents(active.id, true)}
                >
                  <RefreshCw className="h-3 w-3 mr-1.5" />
                  重新拉取
                </Button>
              </div>
            )}

          {!loadingAgents &&
            !active.lastAgentsError &&
            agents.map((a: AgAgentResponse) => (
              <SelectItem
                key={a.id}
                value={a.id}
                className="font-mono text-[12px]"
              >
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  <span className="font-medium">{a.name ?? a.id}</span>
                  {a.model &&
                    (typeof a.model === "object"
                      ? a.model.name
                      : a.model) && (
                      <span className="text-[10px] text-muted-foreground">
                        {typeof a.model === "object"
                          ? a.model.name
                          : a.model}
                      </span>
                    )}
                </div>
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

      <Button
        variant="ghost"
        size="icon-sm"
        className="h-6 w-6 shrink-0"
        onClick={() => {
          probe(active.id);
          loadAgents(active.id, true);
        }}
        title="重新探活 + 拉取 agents"
        disabled={loadingAgents}
      >
        <RefreshCw
          className={cn("h-2.5 w-2.5", loadingAgents && "animate-spin")}
        />
      </Button>
    </div>
  );
}