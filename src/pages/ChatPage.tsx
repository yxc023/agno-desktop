import { useEffect } from "react";
import { SessionList } from "@/components/sessions/SessionList";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { InstancesPanel } from "@/components/instances/InstancesPanel";
import { ApprovalDialog } from "@/components/chat/ApprovalDialog";
import { SubAgentSidePanel } from "@/components/chat/SubAgentSidePanel";
import { FilePreviewPanel } from "@/components/chat/FilePreviewPanel";
import { useInstancesStore } from "@/stores/instances-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUIStore } from "@/stores/ui-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { WelcomeScreen } from "@/pages/WelcomeScreen";
import { VerticalResizeHandle } from "@/components/common/VerticalResizeHandle";
import { useColumnResize } from "@/components/common/useColumnResize";
import { clampWidth } from "@/lib/utils";

/**
 * 分栏宽度上下限
 * - 最小值保证内容基本可读（不会压成一条线）
 * - 最大值防止单侧栏吃掉主聊天区
 */
const MIN_SESSIONS = 200;
const MAX_SESSIONS = 480;
const MIN_RIGHT = 240;
const MAX_RIGHT = 480;
const MIN_FILE_PREVIEW = 320;
const MAX_FILE_PREVIEW = 720;

const DEFAULT_SESSIONS_WIDTH = 260;
const DEFAULT_RIGHT_WIDTH = 300;
const DEFAULT_FILE_PREVIEW_WIDTH = 480;

export function ChatPage() {
  const probe = useInstancesStore((s) => s.probeInstance);
  const active = useInstancesStore((s) => {
    if (!s.activeInstanceId) return null;
    return s.instances.find((i) => i.id === s.activeInstanceId) ?? null;
  });

  // 持久化宽度：初始读 settings store，下次用户手动调整后写回
  const persistedSessions = useSettingsStore((s) => s.chatSessionsWidth);
  const persistedRight = useSettingsStore((s) => s.chatRightWidth);
  const persistedFilePreview = useSettingsStore((s) => s.filePreviewWidth);
  const updateSettings = useSettingsStore((s) => s.update);

  // 当前 session（用于 file preview 的 per-session 过滤）
  const currentSessionId = useSessionsStore((s) => s.currentSessionId);

  // 右侧 InstancesPanel 是否展开（由 AppShell instance 旁的 icon 触发）
  const instancesPanelOpen = useUIStore((s) => s.instancesPanelOpen);
  // File preview 侧栏可见性：仅由 panelOpen 决定；tab 列表本身只是状态，
  // 关闭后保留在 store 里，下次打开自动恢复。
  const filePreviewPanelOpen = useUIStore((s) => s.filePreviewPanelOpen);

  const sessions = useColumnResize({
    initial: clampWidth(
      persistedSessions ?? DEFAULT_SESSIONS_WIDTH,
      MIN_SESSIONS,
      MAX_SESSIONS
    ),
    min: MIN_SESSIONS,
    max: MAX_SESSIONS,
    direction: "right",
    persist: (w) => updateSettings({ chatSessionsWidth: w }),
  });

  const right = useColumnResize({
    initial: clampWidth(
      persistedRight ?? DEFAULT_RIGHT_WIDTH,
      MIN_RIGHT,
      MAX_RIGHT
    ),
    min: MIN_RIGHT,
    max: MAX_RIGHT,
    direction: "left",
    persist: (w) => updateSettings({ chatRightWidth: w }),
  });

  const filePreview = useColumnResize({
    initial: clampWidth(
      persistedFilePreview ?? DEFAULT_FILE_PREVIEW_WIDTH,
      MIN_FILE_PREVIEW,
      MAX_FILE_PREVIEW
    ),
    min: MIN_FILE_PREVIEW,
    max: MAX_FILE_PREVIEW,
    direction: "left",
    persist: (w) => updateSettings({ filePreviewWidth: w }),
  });

  // mount 后若 store 仍未持久化，sync 一次默认值
  useEffect(() => {
    if (persistedSessions == null) {
      updateSettings({ chatSessionsWidth: DEFAULT_SESSIONS_WIDTH });
    }
    if (persistedRight == null) {
      updateSettings({ chatRightWidth: DEFAULT_RIGHT_WIDTH });
    }
    if (persistedFilePreview == null) {
      updateSettings({ filePreviewWidth: DEFAULT_FILE_PREVIEW_WIDTH });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (active && (!active.lastProbeAt || Date.now() - active.lastProbeAt > 60_000)) {
      probe(active.id);
    }
  }, [active, probe]);

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
          style={{ width: sessions.width }}
        >
          <SessionList />
        </aside>

        <VerticalResizeHandle
          ariaLabel="拖动调整会话栏宽度（双击重置）"
          onMouseDown={sessions.dragHandlers.onMouseDown}
          onDoubleClick={sessions.dragHandlers.onDoubleClick}
          onMouseUp={sessions.persist}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <ChatPanel />
        </div>

        {filePreviewPanelOpen && (
          <>
            <VerticalResizeHandle
              ariaLabel="拖动调整预览栏宽度（双击重置）"
              onMouseDown={filePreview.dragHandlers.onMouseDown}
              onDoubleClick={filePreview.dragHandlers.onDoubleClick}
              onMouseUp={filePreview.persist}
            />

            <aside
              className="flex shrink-0 flex-col overflow-hidden border-l border-sidebar-border bg-background"
              style={{ width: filePreview.width }}
            >
              <FilePreviewPanel sessionId={currentSessionId} />
            </aside>
          </>
        )}

        {instancesPanelOpen && (
          <>
            <VerticalResizeHandle
              ariaLabel="拖动调整右侧栏宽度（双击重置）"
              onMouseDown={right.dragHandlers.onMouseDown}
              onDoubleClick={right.dragHandlers.onDoubleClick}
              onMouseUp={right.persist}
            />

            <aside
              className="flex shrink-0 flex-col overflow-y-auto overscroll-y-contain border-l border-sidebar-border bg-sidebar/40 p-3"
              style={{ width: right.width }}
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