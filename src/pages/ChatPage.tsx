import { useEffect, useRef, useState } from "react";
import { SessionList } from "@/components/sessions/SessionList";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { InstancesPanel } from "@/components/instances/InstancesPanel";
import { ApprovalDialog } from "@/components/chat/ApprovalDialog";
import { useInstancesStore } from "@/stores/instances-store";
import { WelcomeScreen } from "@/pages/WelcomeScreen";

const MIN_SESSIONS = 200;
const MIN_RIGHT = 220;
const MIN_CHAT = 400;

export function ChatPage() {
  const probe = useInstancesStore((s) => s.probeInstance);
  const active = useInstancesStore((s) => {
    if (!s.activeInstanceId) return null;
    return s.instances.find((i) => i.id === s.activeInstanceId) ?? null;
  });

  const [sessionsWidth, setSessionsWidth] = useState(260);
  const [rightWidth, setRightWidth] = useState(280);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    side: "left" | "right";
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    if (active && (!active.lastProbeAt || Date.now() - active.lastProbeAt > 60_000)) {
      probe(active.id);
    }
  }, [active, probe]);

  useEffect(() => {
    if (!dragRef.current) return;
    const { side, startX, startWidth } = dragRef.current;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      if (side === "left") {
        setSessionsWidth(
          Math.max(MIN_SESSIONS, Math.min(420, startWidth + dx))
        );
      } else {
        setRightWidth(Math.max(MIN_RIGHT, Math.min(420, startWidth - dx)));
      }
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragRef.current]);

  if (!active) {
    return (
      <>
        <WelcomeScreen />
        <ApprovalDialog />
      </>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 overflow-hidden"
      >
        <aside
          className="flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
          style={{ width: sessionsWidth }}
        >
          <SessionList />
        </aside>

        <ResizeHandle
          onMouseDown={(e) => {
            dragRef.current = {
              side: "left",
              startX: e.clientX,
              startWidth: sessionsWidth,
            };
            // force re-render to attach listeners
            setSessionsWidth((w) => w);
          }}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <ChatPanel />
        </div>

        <ResizeHandle
          onMouseDown={(e) => {
            dragRef.current = {
              side: "right",
              startX: e.clientX,
              startWidth: rightWidth,
            };
            setRightWidth((w) => w);
          }}
        />

        <aside
          className="flex shrink-0 flex-col overflow-y-auto border-l border-sidebar-border bg-sidebar/40 p-3"
          style={{ width: rightWidth }}
        >
          <InstancesPanel />
        </aside>
      </div>
      <ApprovalDialog />
    </>
  );
}

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="group relative w-px shrink-0 cursor-col-resize bg-border hover:bg-accent/50 transition-colors"
    >
      <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-accent/5" />
    </div>
  );
}