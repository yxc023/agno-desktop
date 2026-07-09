import { Link } from "react-router-dom";
import {
  Plus,
  Server,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useActiveInstance,
  useInstancesStore,
  type AgnoInstance,
} from "@/stores/instances-store";
import { formatRelativeTime } from "@/lib/utils";
import { useUIStore } from "@/stores/ui-store";
import { useState } from "react";
import { InstanceFormDialog } from "@/components/instances/InstanceFormDialog";

export function InstancesPage() {
  const instances = useInstancesStore((s) => s.instances);
  const active = useActiveInstance();
  const setActive = useInstancesStore((s) => s.setActiveInstance);
  const remove = useInstancesStore((s) => s.removeInstance);
  const probe = useInstancesStore((s) => s.probeInstance);
  const setShowAdd = useUIStore((s) => s.setShowAddInstance);
  const [editInstance, setEditInstance] = useState<AgnoInstance | null>(null);

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-5xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">AGNO 实例</h1>
            <p className="text-sm text-muted-foreground mt-1">
              管理你连接的所有 AGNO AgentOS 实例
            </p>
          </div>
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4 mr-2" />
            添加实例
          </Button>
        </div>

        {instances.length === 0 ? (
          <Card>
            <CardHeader className="text-center py-12">
              <div className="mx-auto p-3 rounded-full bg-muted w-fit">
                <Server className="h-6 w-6 text-muted-foreground" />
              </div>
              <CardTitle>还没有实例</CardTitle>
              <CardDescription>
                添加一个 AGNO 实例地址开始对话
              </CardDescription>
              <Button
                className="mt-4 w-fit mx-auto"
                onClick={() => setShowAdd(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                添加第一个实例
              </Button>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {instances.map((inst) => (
              <InstanceCard
                key={inst.id}
                instance={inst}
                isActive={active?.id === inst.id}
                onActivate={() => setActive(inst.id)}
                onRemove={() => {
                  if (confirm(`确定删除实例「${inst.name}」？`)) {
                    remove(inst.id);
                  }
                }}
                onProbe={() => probe(inst.id)}
                onEdit={() => setEditInstance(inst)}
              />
            ))}
          </div>
        )}

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">关于 AGNO 实例</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              每个 AGNO 实例是一个运行中的 AgentOS 服务，提供 REST API 与 SSE 流式接口。
              实例可以是：
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>本地的开发实例（如 <code className="px-1 py-0.5 rounded bg-muted">http://127.0.0.1:8000</code>）</li>
              <li>公司部署的共享实例（可能需要 JWT token）</li>
              <li>个人云端部署的实例</li>
            </ul>
            <p>
              添加实例后，应用会自动调用 <code className="px-1 py-0.5 rounded bg-muted">GET /info</code> 验证连通性，
              并拉取 agents / teams / workflows 列表。
            </p>
          </CardContent>
        </Card>
      </div>

      {/* "添加实例" dialog 已在 AppShell 全局挂载（统一管理 showAddInstance
          状态，避免每条路由重复一份 dialog 互相打架）。
          这里只剩"编辑现有实例"dialog，与左侧"添加实例"是独立的两条路径。 */}
      <InstanceFormDialog
        open={!!editInstance}
        instance={editInstance ?? undefined}
        onOpenChange={(v) => !v && setEditInstance(null)}
        onSuccess={() => setEditInstance(null)}
      />
    </div>
  );
}

function InstanceCard({
  instance,
  isActive,
  onActivate,
  onRemove,
  onProbe,
  onEdit,
}: {
  instance: AgnoInstance;
  isActive: boolean;
  onActivate: () => void;
  onRemove: () => void;
  onProbe: () => void;
  onEdit: () => void;
}) {
  const info = instance.lastInfo;
  const reachable = info && (info.agent_count ?? 0) >= 0;

  return (
    <Card
      className={`relative transition-all ${isActive ? "ring-1 ring-primary" : "hover:border-foreground/20"}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <div
              className={`p-1.5 rounded-md ${isActive ? "bg-primary/10" : "bg-muted"} shrink-0`}
            >
              <Server
                className={`h-4 w-4 ${isActive ? "text-primary" : "text-muted-foreground"}`}
              />
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="truncate">{instance.name}</span>
                {isActive && <Badge variant="info">活跃</Badge>}
              </CardTitle>
              <div className="font-mono text-xs text-muted-foreground truncate mt-0.5">
                {instance.baseUrl}
              </div>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>操作</DropdownMenuLabel>
              <DropdownMenuItem onClick={onProbe}>
                <RefreshCw className="h-3.5 w-3.5 mr-2" />
                重新探活
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5 mr-2" />
                编辑配置
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onRemove} destructive>
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                删除实例
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1">
            {reachable ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="text-muted-foreground">
              {instance.lastProbeAt
                ? `已探活 ${formatRelativeTime(instance.lastProbeAt)}`
                : "未探活"}
            </span>
          </div>
          {instance.token && (
            <Badge variant="outline" className="text-[10px]">
              JWT
            </Badge>
          )}
        </div>

        {info ? (
          <div className="grid grid-cols-4 gap-1.5 text-xs">
            <Mini label="AGNO" value={info.agno_version ?? "—"} mono />
            <Mini label="Agents" value={String(info.agent_count ?? 0)} />
            <Mini label="Teams" value={String(info.team_count ?? 0)} />
            <Mini label="Flows" value={String(info.workflow_count ?? 0)} />
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            点击「重新探活」以加载信息
          </div>
        )}

        {!isActive && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={onActivate}
          >
            设为活跃
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Mini({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded bg-muted/50 px-2 py-1">
      <div className="text-[9px] text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className={`text-xs font-medium ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}