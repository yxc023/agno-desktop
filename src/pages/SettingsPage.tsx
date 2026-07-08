import { useSettingsStore } from "@/stores/settings-store";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, User, RotateCcw, Copy } from "lucide-react";
import { useState } from "react";

export function SettingsPage() {
  const {
    userId,
    autoScroll,
    showToolDetails,
    collapseReasoning,
    typewriterEffect,
    update,
    reset,
  } = useSettingsStore();

  const [userIdDraft, setUserIdDraft] = useState(userId);
  const [userIdError, setUserIdError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function validateUserId(v: string): string | null {
    const trimmed = v.trim();
    if (!trimmed) return "user_id 不能为空";
    if (trimmed.length < 2) return "至少 2 个字符";
    if (trimmed.length > 64) return "最多 64 个字符";
    if (!/^[a-zA-Z0-9_\-@.]+$/.test(trimmed)) {
      return "只能包含字母、数字、下划线、连字符、@、点";
    }
    return null;
  }

  function handleSaveUserId() {
    const err = validateUserId(userIdDraft);
    if (err) {
      setUserIdError(err);
      return;
    }
    update({ userId: userIdDraft.trim() });
    setUserIdError(null);
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">设置</h1>
          <p className="text-sm text-muted-foreground mt-1">
            个性化你的 Agno Desktop 体验
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4 text-accent" />
              设备用户
            </CardTitle>
            <CardDescription>
              跨实例共用的用户标识。AGNO 用它来归类 memory、session 和
              user-level 数据。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!userId.trim() && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/[0.04] p-2.5">
                <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
                <div className="text-[12px] text-muted-foreground">
                  user_id 尚未设置，无法发送消息
                </div>
              </div>
            )}
            <div>
              <Label
                htmlFor="userId"
                className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground"
              >
                user_id
              </Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  id="userId"
                  value={userIdDraft}
                  onChange={(e) => {
                    setUserIdDraft(e.target.value);
                    setUserIdError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveUserId();
                  }}
                  placeholder="例如: mike, michael@team"
                  className="font-mono"
                />
                <Button onClick={handleSaveUserId} size="sm" className="h-9">
                  保存
                </Button>
              </div>
              {userIdError && (
                <p className="mt-1.5 font-mono text-[11px] text-destructive">
                  {userIdError}
                </p>
              )}
              {userId && (
                <div className="mt-2 flex items-center gap-2 font-mono text-[10.5px] text-muted-foreground/80">
                  <span>当前:</span>
                  <code className="rounded bg-muted px-1.5 py-0.5">
                    {userId}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(userId);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                    className="hover:text-foreground"
                    title="复制"
                  >
                    {copied ? "已复制" : <Copy className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => setUserIdDraft(userId)}
                    className="hover:text-foreground"
                    title="还原"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                </div>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground/70">
                💡 推荐格式：<code className="rounded bg-muted px-1">名字.环境</code>
                ，如 <code className="rounded bg-muted px-1">mike.dev</code> / <code className="rounded bg-muted px-1">alice@team</code>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">对话偏好</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ToggleRow
              label="自动滚动到底部"
              description="新消息出现时自动滚动到对话底部"
              checked={autoScroll}
              onCheckedChange={(v) => update({ autoScroll: v })}
            />
            <Separator />
            <ToggleRow
              label="显示工具调用详情"
              description="展开所有工具调用的输入/输出"
              checked={showToolDetails}
              onCheckedChange={(v) => update({ showToolDetails: v })}
            />
            <Separator />
            <ToggleRow
              label="默认折叠思考过程"
              description="新消息中的 reasoning 块默认折叠"
              checked={collapseReasoning}
              onCheckedChange={(v) => update({ collapseReasoning: v })}
            />
            <Separator />
            <ToggleRow
              label="打字机效果"
              description="流式文本按 token 实时出现"
              checked={typewriterEffect}
              onCheckedChange={(v) => update({ typewriterEffect: v })}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">重置</CardTitle>
            <CardDescription>
              清除所有偏好设置（包括 user_id）
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => {
              if (confirm("确定重置所有设置？")) reset();
            }}>
              重置设置
            </Button>
          </CardContent>
        </Card>

        <div className="text-center text-xs text-muted-foreground pt-4 pb-2">
          Agno Desktop v0.1 · 对话从 AGNO 服务端拉取，本地仅缓存配置
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5 flex-1">
        <Label className="text-sm font-medium">{label}</Label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}