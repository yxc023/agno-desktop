import { useActiveInstance } from "@/stores/instances-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Layers, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settings-store";

export function MemoryPage() {
  const active = useActiveInstance();
  const userId = useSettingsStore((s) => s.userId);

  if (!active) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        请先选择一个实例
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Layers className="h-5 w-5" />
            用户记忆
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            AGNO 会自动从对话中提取用户级记忆，跨会话复用。
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              当前用户
            </CardTitle>
            <CardDescription>
              设备级身份标识，所有实例共用
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-sm">{userId}</div>
            <p className="text-xs text-muted-foreground mt-2">
              修改方式：设置 → 设备用户
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">记忆列表</CardTitle>
            <CardDescription>
              调 <code className="px-1 py-0.5 rounded bg-muted">GET /memories?user_id=...</code> 拉取
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>v0.1 暂未在 UI 中实现记忆浏览，将在下个版本加入。</p>
            <p className="mt-2">
              你可以直接访问{" "}
              <a
                href={`${active.baseUrl}/docs`}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {active.baseUrl}/docs
              </a>{" "}
              查看 memories API。
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}