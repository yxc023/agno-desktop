import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Terminal, Cpu, KeyRound, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/common/Logo";
import { useInstancesStore } from "@/stores/instances-store";
import { cn } from "@/lib/utils";

export function WelcomeScreen() {
  const navigate = useNavigate();
  const instances = useInstancesStore((s) => s.instances);
  const setActive = useInstancesStore((s) => s.setActiveInstance);

  // 全部空：完整引导
  if (instances.length === 0) {
    return (
      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-dotgrid-dark">
        {/* 角落装饰 */}
        <CornerMarks />

        <div className="relative z-10 w-full max-w-3xl px-6">
          {/* 标题区 */}
          <div className="mb-8 flex items-center gap-3">
            <Logo size={32} />
            <div className="flex flex-col">
              <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground/70">
                AGNO · AGENTOS · v2.6.x
              </span>
              <h1 className="text-[28px] font-semibold tracking-tight">
                连接到你的 <span className="text-gradient-amber">AGNO</span> 实例
              </h1>
            </div>
          </div>

          {/* Terminal-style hero */}
          <div className="group relative overflow-hidden rounded-lg border bg-card shadow-2xl shadow-black/40">
            <div className="flex items-center gap-1.5 border-b bg-muted/30 px-3.5 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-destructive/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
              <span className="ml-3 font-mono text-[10.5px] text-muted-foreground">
                agno-desktop · ~/instances
              </span>
            </div>
            <div className="space-y-1.5 p-5 font-mono text-[12.5px] leading-relaxed">
              <div className="flex gap-2 text-muted-foreground/70">
                <span className="text-accent">$</span>
                <span>agno add</span>
                <span className="text-foreground">--name "本地开发"</span>
              </div>
              <div className="flex gap-2 text-muted-foreground/70">
                <span className="text-muted-foreground/40">›</span>
                <span>connecting to</span>
                <span className="text-info">http://127.0.0.1:8000</span>
                <span className="text-muted-foreground/40">…</span>
                <span className="text-success">ok</span>
              </div>
              <div className="flex gap-2 text-muted-foreground/70">
                <span className="text-muted-foreground/40">›</span>
                <span>detected</span>
                <span className="text-accent">2</span>
                <span>agents,</span>
                <span className="text-accent">0</span>
                <span>teams,</span>
                <span className="text-accent">0</span>
                <span>workflows</span>
              </div>
              <div className="my-2 h-px bg-border/60" />
              <div className="flex gap-2 text-muted-foreground/70">
                <span className="text-accent">$</span>
                <span>agno chat</span>
                <span className="text-foreground">--agent web-search</span>
              </div>
              <div className="flex gap-2">
                <span className="text-info">▸</span>
                <span className="text-foreground/90">你好！</span>
                <span className="text-muted-foreground/60">有什么想了解的？</span>
              </div>
              <div className="ml-5 space-y-0.5 text-muted-foreground/70">
                <div>
                  <span className="text-accent">▸</span>{" "}
                  <span className="text-info">[tool]</span>{" "}
                  <span className="text-foreground">web_search</span>
                  <span className="text-muted-foreground/40"> · 1.2s</span>
                </div>
                <div className="ml-4 text-foreground/80">
                  找到 8 条结果
                </div>
                <div>
                  <span className="text-accent">▸</span>{" "}
                  <span className="text-success">[done]</span>{" "}
                  <span className="text-foreground/90">今天的 Anthropic 头条：</span>
                </div>
                <div className="ml-4 text-foreground/80">
                  美国解除对 Claude Fable 5 的出口管制…
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2 text-muted-foreground/70">
                <span className="text-accent">$</span>
                <span className="streaming-cursor">_</span>
              </div>
            </div>
            {/* 底部琥珀色高光线 */}
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
          </div>

          {/* CTA */}
          <div className="mt-6 flex items-center gap-3">
            <Button
              onClick={() => navigate("/instances")}
              size="lg"
              className="group font-medium"
            >
              添加第一个实例
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
            <Button
              variant="ghost"
              asChild
              size="lg"
              className="font-mono text-xs text-muted-foreground"
            >
              <a
                href="https://docs.agno.com/agent-os/introduction"
                target="_blank"
                rel="noreferrer"
              >
                docs.agno.com →
              </a>
            </Button>
          </div>

          {/* 底部 hint */}
          <p className="mt-5 font-mono text-[10.5px] text-muted-foreground/60">
            <span className="text-accent">tip</span> · 所有实例配置存于本地 localStorage，无任何遥测
          </p>
        </div>
      </div>
    );
  }

  // 有实例但没选：让用户选
  if (instances.length > 0) {
    return (
      <div className="flex flex-1 items-center justify-center bg-dotgrid-dark p-6">
        <div className="w-full max-w-2xl">
          <h2 className="mb-1 text-xl font-semibold">选择一个实例开始</h2>
          <p className="mb-6 text-sm text-muted-foreground">
            你有 {instances.length} 个已连接的 AGNO 实例
          </p>
          <div className="space-y-2">
            {instances.map((inst) => (
              <button
                key={inst.id}
                onClick={() => setActive(inst.id)}
                className="group flex w-full items-center gap-3 rounded-lg border bg-card p-4 text-left transition-all hover:border-accent/40 hover:bg-card/80"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10 text-accent">
                  <Terminal className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{inst.name}</span>
                    {inst.token && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        JWT
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground truncate">
                    {inst.baseUrl}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-accent" />
              </button>
            ))}
          </div>
          <div className="mt-4 text-center">
            <Button variant="ghost" asChild>
              <Link to="/instances">
                <Cpu className="h-3.5 w-3.5" />
                管理实例
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function CornerMarks() {
  return (
    <>
      <span className="absolute left-6 top-6 font-mono text-[10px] text-muted-foreground/30">
        ┌──
      </span>
      <span className="absolute right-6 top-6 font-mono text-[10px] text-muted-foreground/30">
        ──┐
      </span>
      <span className="absolute bottom-6 left-6 font-mono text-[10px] text-muted-foreground/30">
        └──
      </span>
      <span className="absolute bottom-6 right-6 font-mono text-[10px] text-muted-foreground/30">
        ──┘
      </span>
    </>
  );
}