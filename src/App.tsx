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
import { useSettingsStore } from "@/stores/settings-store";

export default function App() {
  const userId = useSettingsStore((s) => s.userId);
  const userIdConfirmed = useSettingsStore((s) => s.userIdConfirmed);
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    if (!userIdConfirmed || !userId.trim()) {
      setShowSetup(true);
    } else {
      setShowSetup(false);
    }
  }, [userId, userIdConfirmed]);

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
        theme="dark"
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
    </BrowserRouter>
  );
}