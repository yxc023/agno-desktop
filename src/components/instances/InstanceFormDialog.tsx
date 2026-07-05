import { useEffect, useState } from "react";
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
import { useInstancesStore, type AgnoInstance } from "@/stores/instances-store";
import { Loader2, CheckCircle2, XCircle, Terminal, AlertCircle } from "lucide-react";
import { Textarea } from "@/components/ui/input";

interface Props {
  open: boolean;
  instance?: AgnoInstance;
  onOpenChange: (v: boolean) => void;
  onSuccess?: (id: string) => void;
}

export function InstanceFormDialog({ open, instance, onOpenChange, onSuccess }: Props) {
  const addInstance = useInstancesStore((s) => s.addInstance);
  const updateInstance = useInstancesStore((s) => s.updateInstance);
  const probe = useInstancesStore((s) => s.probeInstance);
  const loadAgents = useInstancesStore((s) => s.loadAgents);

  const [name, setName] = useState(instance?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(instance?.baseUrl ?? "");
  const [token, setToken] = useState(instance?.token ?? "");
  const [description, setDescription] = useState(instance?.description ?? "");
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<{
    ok: boolean;
    info?: any;
    error?: string;
  } | null>(null);

  const isEdit = !!instance;

  useEffect(() => {
    if (open) {
      setName(instance?.name ?? "");
      setBaseUrl(instance?.baseUrl ?? "");
      setToken(instance?.token ?? "");
      setDescription(instance?.description ?? "");
      setProbeResult(null);
    }
  }, [open, instance]);

  async function handleProbe() {
    if (!baseUrl) return;
    setProbing(true);
    setProbeResult(null);
    try {
      const { AgnoClient } = await import("@/lib/agno-client");
      const client = new AgnoClient({ baseUrl, token: token || null });
      const info = await client.info();
      setProbeResult({ ok: true, info });
    } catch (err) {
      setProbeResult({ ok: false, error: String(err) });
    } finally {
      setProbing(false);
    }
  }

  function isLocalhostUrl(url: string) {
    return /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(url.trim());
  }

  function applyProxy() {
    setBaseUrl("/api");
  }

  function handleSubmit() {
    if (!name.trim() || !baseUrl.trim()) return;
    if (isEdit && instance) {
      updateInstance(instance.id, {
        name: name.trim(),
        baseUrl: baseUrl.trim().replace(/\/+$/, ""),
        token: token || null,
        description: description.trim(),
      });
      probe(instance.id);
      loadAgents(instance.id, true);
      onSuccess?.(instance.id);
    } else {
      const inst = addInstance({
        name: name.trim(),
        baseUrl: baseUrl.trim().replace(/\/+$/, ""),
        token: token || null,
        description: description.trim(),
      });
      probe(inst.id);
      loadAgents(inst.id, true);
      onSuccess?.(inst.id);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-accent" />
            {isEdit ? "编辑实例" : "添加 AGNO 实例"}
          </DialogTitle>
          <DialogDescription>
            输入 AGNO AgentOS 的 base URL。保存后会自动探活。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name" className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              name
            </Label>
            <Input
              id="name"
              placeholder="本地开发实例"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="baseUrl" className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              base url
            </Label>
            <Input
              id="baseUrl"
              placeholder="http://127.0.0.1:8000"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="font-mono"
            />
            {isLocalhostUrl(baseUrl) && (
              <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/[0.04] px-2.5 py-1.5 font-mono text-[10.5px] text-muted-foreground">
                <Terminal className="h-3 w-3 text-accent" />
                <span>
                  本地地址，建议用 <code className="text-accent">/api</code> 走 Vite
                  代理绕过 CORS
                </span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="ml-auto h-auto p-0 text-[10.5px] text-accent"
                  onClick={applyProxy}
                >
                  改用 /api →
                </Button>
              </div>
            )}

            {!isLocalhostUrl(baseUrl) && baseUrl && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/[0.04] px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground">
                <AlertCircle className="h-3 w-3 text-warning mt-0.5 shrink-0" />
                <div className="flex-1 leading-relaxed">
                  远程实例可能被浏览器 CORS 拦截（仅允许
                  <code className="text-foreground"> app.agno.com </code>
                  跨域）。生产环境需后端配置
                  <code className="text-foreground"> Access-Control-Allow-Origin </code>
                  头；本地开发可用 <code className="text-accent">/api</code> 走代理。
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="token" className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              jwt token{" "}
              <span className="text-muted-foreground/60 normal-case font-normal">
                (可选)
              </span>
            </Label>
            <Input
              id="token"
              type="password"
              placeholder="eyJ..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="desc" className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              description
            </Label>
            <Textarea
              id="desc"
              placeholder="实例用途、负责人等"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex items-center gap-2 border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleProbe}
              disabled={!baseUrl || probing}
            >
              {probing ? (
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
              ) : (
                <Terminal className="h-3 w-3 mr-1.5" />
              )}
              测试连接
            </Button>
            {probeResult?.ok && (
              <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-success">
                <CheckCircle2 className="h-3 w-3" />
                <span>
                  agno {probeResult.info.agno_version} ·{" "}
                  {probeResult.info.agent_count} agents
                </span>
              </div>
            )}
            {probeResult && !probeResult.ok && (
              <div className="flex items-center gap-1.5 font-mono text-[10.5px] text-destructive">
                <XCircle className="h-3 w-3" />
                <span className="truncate">{probeResult.error}</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || !baseUrl.trim()}
          >
            {isEdit ? "保存" : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}