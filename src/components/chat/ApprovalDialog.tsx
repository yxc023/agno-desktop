import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, ShieldCheck, Wrench, CheckCircle2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/markdown/CodeBlock";
import { useChatStore } from "@/stores/chat-store";
import { useUIStore } from "@/stores/ui-store";
import { useActiveInstance } from "@/stores/instances-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useEffect } from "react";

export function ApprovalDialog() {
  const pending = useUIStore((s) => s.pendingApproval);
  const setPending = useUIStore((s) => s.setPendingApproval);
  const continueRun = useChatStore((s) => s.continueRun);
  const cancelRun = useChatStore((s) => s.cancelRun);
  const sessions = useSessionsStore((s) => s.currentSessionId);
  const runner = useChatStore((s) => s.runner);
  const messages = useChatStore((s) => s.messagesBySession);
  const active = useActiveInstance();

  // 自动跟踪 runner 的 pauseInfo
  useEffect(() => {
    if (!runner) return;
    const msg = runner.getCurrentMessage();
    if (msg?.awaitingInput && msg.pauseInfo) {
      setPending({
        runId: msg.pauseInfo.runId,
        agentId: useChatStore.getState().selectedAgentId ?? "",
        sessionId: msg.sessionId,
        toolCalls: msg.pauseInfo.toolCalls,
      });
    } else if (!msg?.awaitingInput && pending) {
      setPending(null);
    }
  }, [runner, messages, pending, setPending]);

  const [results, setResults] = useState<Record<string, string>>({});

  if (!pending) return null;

  function handleApprove() {
    const toolResults = pending!.toolCalls.map((tc) => ({
      tool_call_id: tc.tool_call_id,
      content: results[tc.tool_call_id] ?? "approved",
    }));
    continueRun(toolResults);
    setPending(null);
    setResults({});
  }

  function handleReject() {
    cancelRun();
    setPending(null);
    setResults({});
  }

  return (
    <Dialog
      open={!!pending}
      onOpenChange={(v) => {
        if (!v) {
          setPending(null);
          setResults({});
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-warning" />
            Agent 请求输入 / 工具执行确认
          </DialogTitle>
          <DialogDescription>
            当前 run 已暂停，需要你提供工具执行结果才能继续。
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] -mx-2 px-2">
          <div className="space-y-3">
            {pending.toolCalls.map((tc) => (
              <div
                key={tc.tool_call_id}
                className="rounded-lg border bg-card overflow-hidden"
              >
                <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b">
                  <Wrench className="h-3.5 w-3.5 text-blue-400" />
                  <span className="text-xs font-medium">{tc.tool_name}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {tc.tool_call_id.slice(0, 12)}…
                  </Badge>
                </div>

                <div className="p-3 space-y-2">
                  {tc.tool_args && Object.keys(tc.tool_args).length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                        工具参数
                      </div>
                      <CodeBlock
                        language="json"
                        value={JSON.stringify(tc.tool_args, null, 2)}
                        className="my-0"
                      />
                    </div>
                  )}

                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      执行结果 (填入 JSON / 文本)
                    </div>
                    <Textarea
                      value={results[tc.tool_call_id] ?? ""}
                      onChange={(e) =>
                        setResults((prev) => ({
                          ...prev,
                          [tc.tool_call_id]: e.target.value,
                        }))
                      }
                      placeholder='{"result": "..."}'
                      rows={3}
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleReject}>
            <X className="h-4 w-4 mr-2" />
            拒绝并停止
          </Button>
          <Button onClick={handleApprove}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            提交并继续
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}