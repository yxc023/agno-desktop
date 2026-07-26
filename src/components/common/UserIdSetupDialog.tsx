import { useState, useEffect } from "react";
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
import { User, Sparkles, KeyRound, Server } from "lucide-react";
import { useInstancesStore } from "@/stores/instances-store";
import { validateUserId } from "@/lib/user-id";

/**
 * user_id dialog 设计说明：
 * - Enter 不触发提交，仅「保存」按钮可以关闭窗口。
 *   原因：中文输入法下用户用回车把拼音上屏到 input 是高频操作，
 *   拦截 Enter 会让 dialog 直接关闭，体验差。
 * - IME composition 期间的回车由浏览器 / 输入法原生处理，我们
 *   不拦截任何键，因此也不需要 shouldSendOnEnter 这类辅助判定。
 */

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** 要编辑的实例 id —— 必填，setup 永远 per-instance */
  instanceId: string;
  /** 强制模式：关不掉，必须设置 */
  force?: boolean;
  /** dialog 标题里的实例名（可读性用） */
  instanceName?: string;
}

export function UserIdSetupDialog({
  open,
  onOpenChange,
  instanceId,
  force = false,
  instanceName,
}: Props) {
  const inst = useInstancesStore((s) =>
    s.instances.find((i) => i.id === instanceId)
  );
  const updateInstance = useInstancesStore((s) => s.updateInstance);

  const [value, setValue] = useState(inst?.userId ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(inst?.userId ?? "");
      setError(null);
    }
  }, [open, inst?.userId]);

  function handleSave() {
    const trimmed = value.trim();
    const err = validateUserId(trimmed);
    if (err) {
      setError(err);
      return;
    }
    updateInstance(instanceId, { userId: trimmed });
    onOpenChange(false);
  }

  function handleSkip() {
    if (force) return;
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && force) return;
        onOpenChange(v);
      }}
    >
      <DialogContent
        className="max-w-md"
        showClose={!force}
        onInteractOutside={(e) => {
          if (force) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (force) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-4 w-4 text-accent" />
            设置该实例的 user_id
          </DialogTitle>
          <DialogDescription>
            {instanceName ? (
              <span className="flex items-center gap-1.5">
                <Server className="h-3 w-3" />
                实例「{instanceName}」
              </span>
            ) : (
              "为这个 AGNO 实例设置一个身份。"
            )}
            <br />
            AGNO 用 user_id 来归类 memory、session 和 user-level 数据。
            不同实例可以用不同的 user_id（例如 dev / staging / prod）。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="userId"
              className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground"
            >
              user_id <span className="text-destructive">*</span>
            </Label>
            <Input
              id="userId"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              placeholder="例如: mike, michael@team, mike.li"
              className="font-mono"
              autoFocus
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              autoComplete="off"
            />
            {error && (
              <p className="font-mono text-[11px] text-destructive">{error}</p>
            )}
          </div>

          <div className="rounded-md border border-dashed bg-muted/30 p-3">
            <div className="flex items-start gap-2">
              <KeyRound className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
              <div className="space-y-1 text-[11px] text-muted-foreground">
                <div>
                  <span className="font-mono text-foreground">@</span>{" "}
                  可以用来区分团队成员（如{" "}
                  <code className="rounded bg-background px-1">alice@team</code>）
                </div>
                <div>
                  <span className="font-mono text-foreground">.</span>{" "}
                  可以用来区分环境（如{" "}
                  <code className="rounded bg-background px-1">mike.dev</code>）
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/[0.04] px-3 py-2 font-mono text-[10.5px] text-muted-foreground">
            <Sparkles className="h-3 w-3 text-accent shrink-0" />
            <span>
              设置后可在 <span className="text-foreground">实例 → 编辑</span> 页随时修改
            </span>
          </div>
        </div>

        <DialogFooter>
          {!force && (
            <Button variant="ghost" onClick={handleSkip}>
              稍后
            </Button>
          )}
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}