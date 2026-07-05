import * as React from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import {
  Boxes,
  MessageSquare,
  Settings as SettingsIcon,
  Layers,
  ChevronsLeft,
  ChevronsRight,
  Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSettingsStore } from "@/stores/settings-store";
import { useActiveInstance, useInstancesStore } from "@/stores/instances-store";
import { Logo, LogoText } from "@/components/common/Logo";
import { useUIStore } from "@/stores/ui-store";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  shortcut?: string;
  description?: string;
}

const NAV: NavItem[] = [
  { to: "/chat", label: "对话", icon: MessageSquare, shortcut: "⌘1", description: "Chat with agents" },
  { to: "/instances", label: "实例", icon: Boxes, shortcut: "⌘2", description: "Manage AGNO instances" },
  { to: "/memory", label: "记忆", icon: Layers, shortcut: "⌘3", description: "User memories" },
  { to: "/settings", label: "设置", icon: SettingsIcon, shortcut: "⌘4", description: "App preferences" },
];

function NavItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink
          to={item.to}
          className={({ isActive }) =>
            cn(
              "group relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-all",
              "hover:bg-sidebar-accent",
              isActive
                ? "bg-sidebar-accent text-sidebar-foreground font-medium"
                : "text-muted-foreground hover:text-sidebar-foreground",
              collapsed && "justify-center px-0"
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && !collapsed && (
                <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-accent" />
              )}
              <item.icon
                className={cn(
                  "h-[15px] w-[15px] shrink-0 transition-colors",
                  isActive && "text-accent"
                )}
                strokeWidth={isActive ? 2.25 : 1.75}
              />
              {!collapsed && (
                <>
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut && (
                    <span className="font-mono text-[10px] text-muted-foreground/60">
                      {item.shortcut}
                    </span>
                  )}
                </>
              )}
            </>
          )}
        </NavLink>
      </TooltipTrigger>
      {collapsed && (
        <TooltipContent side="right" className="font-mono text-xs">
          {item.label}
          {item.shortcut && (
            <span className="ml-2 text-muted-foreground">
              {item.shortcut}
            </span>
          )}
        </TooltipContent>
      )}
    </Tooltip>
  );
}

export function AppShell() {
  const collapsed = useSettingsStore((s) => s.sidebarCollapsed);
  const update = useSettingsStore((s) => s.update);
  const active = useActiveInstance();
  const setActive = useInstancesStore((s) => s.setActiveInstance);
  const instances = useInstancesStore((s) => s.instances);
  const setShowAdd = useUIStore((s) => s.setShowAddInstance);

  return (
    <TooltipProvider delayDuration={500}>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        {/* ============================================================
            左侧主导航（终端美学 + 暖琥珀点缀）
            ============================================================ */}
        <aside
          className={cn(
            "flex flex-col border-r border-sidebar-border bg-sidebar/80 backdrop-blur-sm transition-[width] duration-200",
            collapsed ? "w-[56px]" : "w-[244px]"
          )}
        >
          {/* Logo */}
          <div
            className={cn(
              "flex h-14 items-center border-b border-sidebar-border",
              collapsed ? "justify-center px-0" : "gap-2 px-4"
            )}
          >
            {collapsed ? <Logo size={26} /> : <LogoText />}
          </div>

          {/* 主导航 */}
          <nav className="flex-1 space-y-0.5 p-2">
            {NAV.map((item) => (
              <NavItem
                key={item.to}
                item={item}
                collapsed={collapsed}
              />
            ))}
          </nav>

          {/* 底部：当前实例 + 操作 */}
          <div className="space-y-1.5 border-t border-sidebar-border p-2">
            {active && !collapsed && (
              <button
                onClick={() => setActive(active.id)}
                className="group w-full rounded-md bg-sidebar-accent/60 hover:bg-sidebar-accent px-2.5 py-2 text-left transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inset-0 animate-ping rounded-full bg-success/60" />
                    <span className="relative h-1.5 w-1.5 rounded-full bg-success" />
                  </span>
                  <span className="text-[12px] font-medium truncate">
                    {active.name}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                  <span className="truncate">{active.baseUrl.replace(/^https?:\/\//, "")}</span>
                  <span className="text-accent">·</span>
                  <span>{active.lastInfo?.agno_version ?? "—"}</span>
                </div>
              </button>
            )}

            {!collapsed && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAdd(true)}
                className="w-full justify-start text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="text-[12px]">添加实例</span>
              </Button>
            )}

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "w-full font-mono text-[10px] text-muted-foreground/70 hover:text-foreground",
                    collapsed && "px-0"
                  )}
                  onClick={() => update({ sidebarCollapsed: !collapsed })}
                >
                  {collapsed ? (
                    <ChevronsRight className="h-3.5 w-3.5" />
                  ) : (
                    <>
                      <ChevronsLeft className="h-3.5 w-3.5" />
                      <span>折叠</span>
                    </>
                  )}
                </Button>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">展开侧栏</TooltipContent>
              )}
            </Tooltip>
          </div>
        </aside>

        {/* ============================================================
            主区域
            ============================================================ */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      </div>
    </TooltipProvider>
  );
}