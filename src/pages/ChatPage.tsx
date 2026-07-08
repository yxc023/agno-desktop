import { useCallback, useEffect, useRef, useState } from "react";
import { SessionList } from "@/components/sessions/SessionList";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { InstancesPanel } from "@/components/instances/InstancesPanel";
import { ApprovalDialog } from "@/components/chat/ApprovalDialog";
import { SubAgentSidePanel } from "@/components/chat/SubAgentSidePanel";
import { useInstancesStore } from "@/stores/instances-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUIStore } from "@/stores/ui-store";
import { WelcomeScreen } from "@/pages/WelcomeScreen";

/**
 * 分栏宽度上下限
 * - 最小值保证内容基本可读（不会压成一条线）
 * - 最大值防止单侧栏吃掉主聊天区
 */
const MIN_SESSIONS = 200;
const MAX_SESSIONS = 480;
const MIN_RIGHT = 240;
const MAX_RIGHT = 480;

const DEFAULT_SESSIONS_WIDTH = 260;
const DEFAULT_RIGHT_WIDTH = 300;

interface DragState {
  side: "left" | "right";
  startX: number;
  startWidth: number;
}

export function ChatPage() {
  const probe = useInstancesStore((s) => s.probeInstance);
  const active = useInstancesStore((s) => {
    if (!s.activeInstanceId) return null;
    return s.instances.find((i) => i.id === s.activeInstanceId) ?? null;
  });

  // 持久化宽度：初始读 settings store，下次用户手动调整后写回
  const persistedSessions = useSettingsStore((s) => s.chatSessionsWidth);
  const persistedRight = useSettingsStore((s) => s.chatRightWidth);
  const updateSettings = useSettingsStore((s) => s.update);

  // 右侧 InstancesPanel 是否展开（由 AppShell instance 旁的 icon 触发）
  const instancesPanelOpen = useUIStore((s) => s.instancesPanelOpen);

  const [sessionsWidth, setSessionsWidth] = useState(
    clampWidth(
      persistedSessions ?? DEFAULT_SESSIONS_WIDTH,
      MIN_SESSIONS,
      MAX_SESSIONS
    )
  );
  const [rightWidth, setRightWidth] = useState(
    clampWidth(persistedRight ?? DEFAULT_RIGHT_WIDTH, MIN_RIGHT, MAX_RIGHT)
  );

  // 拖动状态用 state 而非 ref —— ref.current 变化不会触发 useEffect，
  // 所以原始实现里 onMouseDown 后 setSessionsWidth((w) => w) 不会让监听器
  // 重新挂载，拖动自然"无反应"。
  const [drag, setDrag] = useState<DragState | null>(null);

  // mount 后若 store 仍未持久化，sync 一次默认值
  useEffect(() => {
    if (persistedSessions == null) {
      updateSettings({ chatSessionsWidth: DEFAULT_SESSIONS_WIDTH });
    }
    if (persistedRight == null) {
      updateSettings({ chatRightWidth: DEFAULT_RIGHT_WIDTH });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (active && (!active.lastProbeAt || Date.now() - active.lastProbeAt > 60_000)) {
      probe(active.id);
    }
  }, [active, probe]);

  // 拖动监听器：依赖 drag state，drag 变化时正确 attach / detach
  useEffect(() => {
    if (!drag) return;
    const { side, startX, startWidth } = drag;
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      if (side === "left") {
        setSessionsWidth(clampWidth(startWidth + dx, MIN_SESSIONS, MAX_SESSIONS));
      } else {
        setRightWidth(clampWidth(startWidth - dx, MIN_RIGHT, MAX_RIGHT));
      }
    };
    const onUp = () => {
      setDrag(null);
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [drag]);

  // 拖完落定后写回 settings store（persist）
  // 这里用最新 width 的 ref，避免在 onMove 每次都 persist
  const widthRef = useRef({ sessions: sessionsWidth, right: rightWidth });
  useEffect(() => {
    widthRef.current = { sessions: sessionsWidth, right: rightWidth };
  }, [sessionsWidth, rightWidth]);
  const persistSessions = useCallback(
    () => updateSettings({ chatSessionsWidth: widthRef.current.sessions }),
    [updateSettings]
  );
  const persistRight = useCallback(
    () => updateSettings({ chatRightWidth: widthRef.current.right }),
    [updateSettings]
  );

  // 双击 handle → 重置为默认宽度
  const resetLeft = useCallback(() => {
    setSessionsWidth(DEFAULT_SESSIONS_WIDTH);
    updateSettings({ chatSessionsWidth: DEFAULT_SESSIONS_WIDTH });
  }, [updateSettings]);
  const resetRight = useCallback(() => {
    setRightWidth(DEFAULT_RIGHT_WIDTH);
    updateSettings({ chatRightWidth: DEFAULT_RIGHT_WIDTH });
  }, [updateSettings]);

  if (!active) {
    return (
      <>
        <WelcomeScreen />
        <ApprovalDialog />
        <SubAgentSidePanel />
      </>
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className="flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
          style={{ width: sessionsWidth }}
        >
          <SessionList />
        </aside>

        <ResizeHandle
          ariaLabel="拖动调整会话栏宽度（双击重置）"
          onMouseDown={(e) =>
            setDrag({
              side: "left",
              startX: e.clientX,
              startWidth: sessionsWidth,
            })
          }
          onDoubleClick={resetLeft}
          onMouseUp={persistSessions}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <ChatPanel />
        </div>

        {instancesPanelOpen && (
          <>
            <ResizeHandle
              ariaLabel="拖动调整右侧栏宽度（双击重置）"
              onMouseDown={(e) =>
                setDrag({
                  side: "right",
                  startX: e.clientX,
                  startWidth: rightWidth,
                })
              }
              onDoubleClick={resetRight}
              onMouseUp={persistRight}
            />

            <aside
              className="flex shrink-0 flex-col overflow-y-auto border-l border-sidebar-border bg-sidebar/40 p-3"
              style={{ width: rightWidth }}
            >
              <InstancesPanel />
            </aside>
          </>
        )}
      </div>
      <ApprovalDialog />
      <SubAgentSidePanel />
    </>
  );
}

function clampWidth(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * ResizeHandle — 拖拽调整相邻栏宽度的把手
 *
 * 视觉设计：
 * - 默认 w-px 1px 描边，作为相邻栏的分隔线
 * - 不做 hover 样式变化（之前加宽 + 高亮 grip 的视觉反馈反而让用户怀疑
 *   "是不是没拖到"——拖动操作正常，1px 边框就是稳定的视觉锚点）
 * - 双击触发重置
 * - 用更大的 hit area（-left-1 -right-1）让鼠标更容易命中
 */
function ResizeHandle({
  onMouseDown,
  onDoubleClick,
  onMouseUp,
  ariaLabel,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onMouseUp: () => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      title="拖动调整宽度 · 双击重置"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onMouseUp={onMouseUp}
      className="relative w-px shrink-0 cursor-col-resize bg-border hover:bg-accent/40"
    >
      {/* hit area: 扩大到 -left-1 -right-1，让 8px 范围内都能命中 */}
      <div className="pointer-events-none absolute inset-y-0 -left-1 -right-1" />
    </div>
  );
}