import { useSettingsStore, type Theme } from "@/stores/settings-store";
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
import {
  AlertTriangle,
  User,
  RotateCcw,
  Copy,
  Sun,
  Moon,
  Monitor,
  Palette,
  Download,
  RefreshCw,
  Info,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { useUpdater } from "@/hooks/use-updater";
import { getTauriAppVersion } from "@/lib/tauri";

export function SettingsPage() {
  const {
    userId,
    theme,
    autoScroll,
    showToolDetails,
    collapseReasoning,
    typewriterEffect,
    autoCheckUpdate,
    update,
    reset,
  } = useSettingsStore();

  const updater = useUpdater();
  const [appVersion, setAppVersion] = useState<string>("…");
  // 「立即更新」按钮本地 pending 状态：点击瞬间立刻变 loading，
  // 不依赖 updater.status（后者要等 Rust 端返回才有，下载太快时
  // 用户根本看不到反馈）。
  const [installPending, setInstallPending] = useState(false);

  useEffect(() => {
    getTauriAppVersion().then((v) => setAppVersion(v ?? "dev"));
  }, []);

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
            <CardTitle className="text-base flex items-center gap-2">
              <Palette className="h-4 w-4 text-accent" />
              外观
            </CardTitle>
            <CardDescription>
              选择浅色或深色主题，跟随系统则按 OS 偏好自动切换。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2">
              <ThemeOption
                value="light"
                current={theme}
                onSelect={(v) => update({ theme: v })}
                icon={Sun}
                label="浅色"
              />
              <ThemeOption
                value="dark"
                current={theme}
                onSelect={(v) => update({ theme: v })}
                icon={Moon}
                label="深色"
              />
              <ThemeOption
                value="system"
                current={theme}
                onSelect={(v) => update({ theme: v })}
                icon={Monitor}
                label="跟随系统"
              />
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
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="h-4 w-4 text-accent" />
              自动更新
            </CardTitle>
            <CardDescription>
              通过官方发布服务器检查并安装新版本。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!updater.available && (
              <div className="flex items-start gap-2 rounded-md border border-info/40 bg-info/[0.04] p-2.5">
                <Info className="h-3.5 w-3.5 text-info shrink-0 mt-0.5" />
                <div className="text-[12px] text-muted-foreground leading-relaxed">
                  当前是浏览器预览模式，自动更新不会运行。
                  <br />
                  该功能仅在打包后的桌面客户端（macOS / Windows / Linux）中生效——
                  运行 <code className="font-mono text-[11px] bg-muted px-1 rounded">bun run build:desktop</code> 构建后即可使用。
                </div>
              </div>
            )}

            <ToggleRow
              label="启动时自动检查更新"
              description="应用启动后静默检查，发现新版本时通过右下角通知"
              checked={autoCheckUpdate}
              onCheckedChange={(v) => update({ autoCheckUpdate: v })}
            />
            <Separator />

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5 flex-1">
                <Label className="text-sm font-medium">当前版本</Label>
                <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  v{appVersion}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={
                  updater.status === "checking" ||
                  updater.status === "downloading"
                }
                onClick={() => {
                  // 浏览器 / 移动端 / dev 模式下给出明确反馈，而不是按钮
                  // 看起来"灰着没反应"让用户以为是 bug
                  if (!updater.available) {
                    toast.info("自动更新仅在桌面客户端中生效", {
                      description:
                        "请运行 bun run build:desktop 构建桌面版本，或在已安装的 Agno Desktop 中使用此功能。",
                      duration: 5000,
                    });
                    return;
                  }
                  void updater.checkNow();
                }}
                className="h-8"
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5 mr-1.5",
                    updater.status === "checking" && "animate-spin"
                  )}
                />
                {updater.status === "checking" ? "检查中…" : "立即检查"}
              </Button>
            </div>

            {updater.status === "available" && updater.info && (
              <>
                <Separator />
                <div className="rounded-md border border-accent/30 bg-accent/[0.05] p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">
                      发现新版本 v{updater.info.version}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={updater.dismiss}
                        disabled={installPending}
                      >
                        稍后
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        disabled={installPending}
                        onClick={() => {
                          // 点击瞬间 setState(true)，React 立刻进入 loading 渲染；
                          // 不依赖 updater.install 内部 setStateSafe("downloading")（那要
                          // 等 Rust 端返回，对几秒就完成的下载来说会闪一下）。
                          setInstallPending(true);
                          updater.install().finally(() => {
                            setInstallPending(false);
                          });
                        }}
                      >
                        {installPending ? (
                          <>
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            下载中…
                          </>
                        ) : (
                          <>
                            <Download className="h-3 w-3 mr-1" />
                            立即更新
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                  {updater.info.notes && (
                    <div className="text-[11.5px] text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap">
                      {updater.info.notes}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ready 状态由 AppTitleBar 的「重启」按钮处理（标题栏右侧常驻），
                避免在 settings 页面重复一遍触发路径 */}
            {updater.status === "ready" && updater.info && (
              <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/[0.05] p-2.5 text-[12px] text-muted-foreground">
                <span className="font-mono text-success">●</span>
                <span>
                  v{updater.info.version} 已下载完成 — 点击标题栏右上角「重启」按钮应用更新
                </span>
              </div>
            )}

            {updater.status === "error" && updater.error && (
              <>
                <Separator />
                <div className="rounded-md border border-destructive/30 bg-destructive/[0.05] p-3 space-y-1.5">
                  <div className="text-sm font-medium text-destructive">
                    更新失败
                  </div>
                  <div className="text-[11.5px] text-muted-foreground font-mono break-all">
                    {updater.error}
                  </div>
                </div>
              </>
            )}
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
          Agno Desktop v{appVersion === "…" ? "0.1" : appVersion} · 对话从 AGNO
          服务端拉取，本地仅缓存配置
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

/**
 * 主题选项卡片：浅色 / 深色 / 跟随系统。
 * - 选中态用 accent 描边 + 淡琥珀底
 * - icon + label 居中展示，方便用户一眼看全三种状态
 */
function ThemeOption({
  value,
  current,
  onSelect,
  icon: Icon,
  label,
}: {
  value: Theme;
  current: Theme;
  onSelect: (v: Theme) => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  const active = current === value;
  return (
    <button
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className={cn(
        "group flex flex-col items-center gap-2 rounded-md border px-3 py-3 transition-all",
        active
          ? "border-accent/50 bg-accent/[0.06] text-foreground"
          : "border-border bg-card/30 text-muted-foreground hover:border-accent/30 hover:text-foreground"
      )}
    >
      <Icon
        className={cn(
          "h-5 w-5 transition-colors",
          active ? "text-accent" : "text-muted-foreground group-hover:text-foreground"
        )}
      />
      <span className="text-[12px] font-medium">{label}</span>
      {active && (
        <span className="font-mono text-[9.5px] uppercase tracking-wider text-accent/80">
          active
        </span>
      )}
    </button>
  );
}