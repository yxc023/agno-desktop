/**
 * InstanceInfoStrip — 会话栏顶部的实例信息条
 *
 * 视觉：实例名 + baseUrl + 探活状态点（小绿点 / 红色）。
 * 放在 SessionList 的最顶部（"会话" header 之前），让用户随时能看到
 * "当前操作的是哪个实例、连的是哪条 URL"——这条信息原来挤在 ChatPanel
 * header 里，太窄容易 overflow，移到 200-360px 宽的会话栏更合适。
 *
 * 设计取舍：
 * - 不重复 AppShell 底部 ActiveInstanceCard 的所有信息（version / 详情按钮）；
 *   这条 strip 只负责"我在哪个实例、它连得上吗"，更复杂的东西点实例卡片进
 *   InstancesPanel 看。
 * - 不响应 width 变化做折叠：sidebar 拖窄到 < 240px 时 baseUrl 走 truncate，
 *   用户体验上"看到一点"比"折完看不出域名"更好。
 */

import { Loader2 } from "lucide-react";
import { useActiveInstance } from "@/stores/instances-store";

export function InstanceInfoStrip() {
  const active = useActiveInstance();

  if (!active) {
    return (
      <div className="flex items-center gap-1.5 border-b border-sidebar-border bg-sidebar-accent/30 px-3 py-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
        <span className="font-mono text-[10.5px] text-muted-foreground/60">
          无活跃实例
        </span>
      </div>
    );
  }

  const probed = active.lastProbeAt != null;
  // probe 错误注入在 lastInfo._error（见 instances-store.ts:probeInstance）；
  // lastInfo 类型是 AgInfoResponse，但运行时可能是带 _error 的对象。
  const probeError = (active.lastInfo as unknown as { _error?: unknown } | null)
    ?._error;
  const ok = probed && !probeError;

  return (
    <div
      className="flex items-center gap-2 border-b border-sidebar-border bg-sidebar-accent/30 px-3 py-2"
      title={`${active.name} · ${active.baseUrl}`}
    >
      {probed ? (
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            ok ? "bg-success" : "bg-destructive"
          }`}
          aria-label={ok ? "实例在线" : "实例连接失败"}
        />
      ) : (
        <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin text-muted-foreground/60" />
      )}
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[12px] font-medium text-foreground/90">
          {active.name}
        </span>
        <span className="truncate font-mono text-[10px] text-muted-foreground/70">
          {active.baseUrl}
        </span>
      </div>
    </div>
  );
}