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
import { User, Sparkles, KeyRound } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** 强制模式：关不掉，必须设置 */
  force?: boolean;
}

export function UserIdSetupDialog({ open, onOpenChange, force = false }: Props) {
  const userId = useSettingsStore((s) => s.userId);
  const update = useSettingsStore((s) => s.update);

  const [value, setValue] = useState(userId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(userId);
      setError(null);
    }
  }, [open, userId]);

  function validate(v: string): string | null {
    const trimmed = v.trim();
    if (!trimmed) return "user_id 不能为空";
    if (trimmed.length < 2) return "至少 2 个字符";
    if (trimmed.length > 64) return "最多 64 个字符";
    if (!/^[a-zA-Z0-9_\-@.]+$/.test(trimmed)) {
      return "只能包含字母、数字、下划线、连字符、@、点";
    }
    return null;
  }

  function handleSave() {
    const err = validate(value);
    if (err) {
      setError(err);
      return;
    }
    update({ userId: value.trim(), userIdConfirmed: true });
    onOpenChange(false);
  }

  function handleSkip() {
    if (force) return; // 强制模式不能跳
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && force) return; // 强制模式关不掉
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
            设置你的 user_id
          </DialogTitle>
          <DialogDescription>
            AGNO 用 user_id 来归类你的 memory、session 和 user-level 数据。
            <br />
            同一台设备上多实例共用一个 user_id。
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
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
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
              设置后可在 <span className="text-foreground">设置</span> 页随时修改
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