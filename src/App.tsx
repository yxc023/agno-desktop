import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { ChatPage } from "@/pages/ChatPage";
import { InstancesPage } from "@/pages/InstancesPage";
import { MemoryPage } from "@/pages/MemoryPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { UserIdSetupDialog } from "@/components/common/UserIdSetupDialog";
import { UpdateToast } from "@/components/common/UpdateToast";
import { useSettingsStore } from "@/stores/settings-store";
import { useEffectiveTheme } from "@/hooks/use-effective-theme";
import { loadRemoteContextWindows } from "@/lib/model-context-windows";

export default function App() {
  const userId = useSettingsStore((s) => s.userId);
  const userIdConfirmed = useSettingsStore((s) => s.userIdConfirmed);
  const resolved = useEffectiveTheme();
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    if (!userIdConfirmed || !userId.trim()) {
      setShowSetup(true);
    } else {
      setShowSetup(false);
    }
  }, [userId, userIdConfirmed]);

  // 同步 resolved theme 到 <html class="dark">。
  // index.html 的同步脚本已经在首次加载时设置好了初值，这里处理后续切换。
  // resolved 已处理 "system" 模式 + OS 主题变化，所以单一 useEffect 就够了。
  useEffect(() => {
    const root = document.documentElement;
    if (resolved === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [resolved]);

  // 启动时拉取远程 model context window 配置。
  // 函数内部幂等（并发安全），StrictMode 双调用只触发一次 fetch。
  // 失败静默 fallback 到内置 map，UI 仍然可用。
  useEffect(() => {
    loadRemoteContextWindows().catch(() => {});
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/instances" element={<InstancesPage />} />
          <Route path="/memory" element={<MemoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <Toaster
        position="bottom-right"
        theme={resolved}
        toastOptions={{
          classNames: {
            toast: "bg-card border text-foreground",
            description: "text-muted-foreground",
          },
        }}
      />
      <UserIdSetupDialog
        open={showSetup}
        onOpenChange={setShowSetup}
        force={!userIdConfirmed || !userId.trim()}
      />
      <UpdateToast />
    </BrowserRouter>
  );
}