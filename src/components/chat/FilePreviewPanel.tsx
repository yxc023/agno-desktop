/**
 * FilePreviewPanel — 右侧 tab 侧栏，预览 agent 回复里的静态文件链接。
 *
 * 触发链：
 *   Markdown.tsx 点击 <a>
 *     → detectPreviewKind(href)
 *     → previewFile(sessionId, href, kind)（ui-store action）
 *     → 面板自动打开 + tab 创建/复用 + state=loading
 *   FilePreviewPanel 内部 effect 监听 active tab 的 state=loading
 *     → fetchPreviewContent(url)
 *     → setTabLoaded / setTabError
 *
 * Per-session 持久化：
 *   - tabs 按 sessionId 字段过滤渲染。切到别的 session 时该 session 的 tabs
 *     不显示但仍存在 store 里；切回时恢复。
 *   - 跨 app 重启**不**持久化（v1 范围内；chat 消息本身也不持久化）。
 *
 * 宽度：
 *   - 默认 480 px，可拖拽（useColumnResize），持久化到 settings.filePreviewWidth
 *
 * 空状态：tabs.length === 0 → 显示提示。
 * 加载中：spinner + 标题。
 * 错误：红条 + [在浏览器中打开] [复制 URL]。
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  AlertCircle,
  Copy,
  ExternalLink,
  FileCode,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  X,
} from "lucide-react";
import { Markdown } from "@/components/markdown/Markdown";
import { CodeBlock } from "@/components/markdown/CodeBlock";
import { Button } from "@/components/ui/button";
import { cn, copyToClipboard } from "@/lib/utils";
import { openExternalUrl } from "@/lib/open-external-url";
import {
  useActiveFileTab,
  useUIStore,
  type FilePreviewTab,
} from "@/stores/ui-store";
import { fetchPreviewContent, FileFetchError } from "@/lib/file-fetcher";
import type { PreviewKind } from "@/lib/preview-kind";

const KIND_ICON: Record<PreviewKind, typeof FileText> = {
  md: FileText,
  text: FileText,
  code: FileCode,
  image: ImageIcon,
  html: Globe,
};

interface Props {
  /** 当前 session；null 时面板只显示自己的 empty state */
  sessionId: string | null;
}

export function FilePreviewPanel({ sessionId }: Props) {
  // 注意：selector 里**不能**调 .filter() —— 每次返回新数组会让 zustand
  // 的 useSyncExternalStore 误判 snapshot 变了，导致无限 re-render。
  // 先选 raw tabs，再在 useMemo 里按 sessionId 派生。
  const allTabs = useUIStore((s) => s.filePreviewTabs);
  const tabs = useMemo(
    () => (sessionId ? allTabs.filter((t) => t.sessionId === sessionId) : []),
    [allTabs, sessionId]
  );
  const activeTab = useActiveFileTab();
  const closeFileTab = useUIStore((s) => s.closeFileTab);
  const selectFileTab = useUIStore((s) => s.selectFileTab);
  const closePanel = useUIStore((s) => s.closeFilePreviewPanel);

  useFetchOnTabActive(activeTab);

  const onTabMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>, tabId: string) => {
      if (e.button === 1) {
        e.preventDefault();
        closeFileTab(tabId);
      }
    },
    [closeFileTab]
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-2 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
          预览
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={closePanel}
          title="关闭预览侧栏"
          aria-label="关闭预览侧栏"
          className="h-6 w-6"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {tabs.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div
            className="flex shrink-0 overflow-x-auto border-b border-border/40 bg-muted/20"
            role="tablist"
          >
            {tabs.map((tab) => (
              <TabChip
                key={tab.id}
                tab={tab}
                active={tab.id === activeTab?.id}
                onSelect={() => selectFileTab(tab.id)}
                onClose={() => closeFileTab(tab.id)}
                onMouseDown={(e) => onTabMouseDown(e, tab.id)}
              />
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto overscroll-y-contain">
            {activeTab ? (
              <TabBody tab={activeTab} />
            ) : (
              <EmptyState />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ───────────────────── tab chip ─────────────────────

const TabChip = memo(function TabChip({
  tab,
  active,
  onSelect,
  onClose,
  onMouseDown,
}: {
  tab: FilePreviewTab;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onMouseDown: (e: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const Icon = KIND_ICON[tab.kind] ?? FileText;
  return (
    <div
      role="tab"
      aria-selected={active}
      onMouseDown={onMouseDown}
      onClick={onSelect}
      className={cn(
        "group inline-flex max-w-[180px] cursor-pointer items-center gap-1.5 border-r border-border/40 px-2.5 py-1.5 text-left transition-colors",
        active
          ? "bg-background text-foreground"
          : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
      )}
      title={tab.url}
    >
      <Icon className="h-3 w-3 shrink-0 opacity-70" />
      <span className="truncate font-mono text-[11px]">{tab.title}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label={`关闭 ${tab.title}`}
        title="关闭"
        className="ml-0.5 rounded p-0.5 opacity-0 transition-opacity hover:bg-foreground/10 group-hover:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
});

// ───────────────────── tab body ─────────────────────

const TabBody = memo(function TabBody({ tab }: { tab: FilePreviewTab }) {
  if (tab.state === "loading") return <LoadingState title={tab.title} />;
  if (tab.state === "error") {
    return (
      <ErrorState
        url={tab.url}
        message={tab.error ?? "未知错误"}
      />
    );
  }
  return <LoadedBody tab={tab} />;
});

function LoadedBody({ tab }: { tab: FilePreviewTab }) {
  switch (tab.kind) {
    case "md":
      return (
        <div className="px-4 py-3">
          <Markdown>{tab.content ?? ""}</Markdown>
        </div>
      );
    case "text":
      return (
        <pre className="m-0 whitespace-pre-wrap break-words px-4 py-3 font-mono text-[12.5px] leading-relaxed text-foreground/90">
          {tab.content ?? ""}
        </pre>
      );
    case "code":
      return (
        <div className="px-3 py-2">
          <CodeBlock
            language={guessLanguageFromUrl(tab.url)}
            value={tab.content ?? ""}
          />
        </div>
      );
    case "image":
      return (
        <div className="flex h-full min-h-[200px] items-center justify-center p-3">
          <img
            src={tab.url}
            alt={tab.title}
            className="max-h-full max-w-full object-contain"
            loading="lazy"
          />
        </div>
      );
    case "html":
      return (
        <iframe
          src={tab.url}
          title={tab.title}
          sandbox=""
          className="h-full w-full border-0 bg-white"
        />
      );
  }
}

// ───────────────────── states ─────────────────────

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground/70">
      <FileText className="h-7 w-7 opacity-40" />
      <p className="text-[12.5px]">
        点击聊天里的 <code>.md</code> / <code>.txt</code> / 图片 / 代码链接即可预览
      </p>
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/40">
        preview
      </p>
    </div>
  );
}

function LoadingState({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground/70">
      <Loader2 className="h-5 w-5 animate-spin text-accent" />
      <p className="font-mono text-[11px]">加载中 · {title}</p>
    </div>
  );
}

function ErrorState({ url, message }: { url: string; message: string }) {
  return (
    <div className="flex h-full flex-col items-start gap-3 p-4">
      <div className="flex w-full items-start gap-2 rounded-md border border-destructive/40 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive">
        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="flex-1">
          <div className="font-medium">加载失败</div>
          <div className="mt-0.5 font-mono text-destructive/80 break-all">
            {message}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void openExternalUrl(url)}
          className="h-7 text-[11px]"
        >
          <ExternalLink className="mr-1 h-3 w-3" />
          在浏览器中打开
        </Button>
        <CopyUrlButton url={url} />
      </div>
      <div className="mt-1 font-mono text-[10px] text-muted-foreground/60 break-all">
        {url}
      </div>
    </div>
  );
}

function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        const ok = await copyToClipboard(url);
        if (ok) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
      className="h-7 text-[11px]"
    >
      <Copy className="mr-1 h-3 w-3" />
      {copied ? "已复制" : "复制 URL"}
    </Button>
  );
}

// ───────────────────── fetch effect ─────────────────────

/**
 * 监听 active tab 的 loading 状态，自动 fetch。
 * - 已经在 loading 时启动一次 fetch；切到已 loaded 的 tab 不会重复抓。
 * - fetch 完成后调 setTabLoaded / setTabError。
 * - 组件 unmount / tab 切换 / tab.id 变更时取消未完成的 fetch（避免旧结果
 *   覆盖新 tab）。
 */
function useFetchOnTabActive(tab: FilePreviewTab | null) {
  const setTabLoaded = useUIStore((s) => s.setTabLoaded);
  const setTabError = useUIStore((s) => s.setTabError);
  useEffect(() => {
    if (!tab) return;
    if (tab.state !== "loading") return;
    // image / html 由标签自带 fetch，不需要预先 fetch
    if (tab.kind === "image" || tab.kind === "html") {
      // 直接标记 loaded；render 端用 <img>/<iframe> 自己处理错误
      setTabLoaded(tab.id, "", tab.mime);
      return;
    }

    let cancelled = false;
    const ac = new AbortController();
    fetchPreviewContent(tab.url, { signal: ac.signal })
      .then((r) => {
        if (cancelled) return;
        setTabLoaded(tab.id, r.content, r.mime);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg =
          e instanceof FileFetchError
            ? `${e.code}: ${e.message}`
            : e instanceof Error
              ? e.message
              : "未知错误";
        setTabError(tab.id, msg);
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
    // 只在 tab.id / tab.url / tab.state 变化时重跑；其它字段无关。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.id, tab?.state, tab?.url]);
}

// ───────────────────── helpers ─────────────────────

/**
 * 从 URL 取扩展名作为 CodeBlock 的 language hint。CodeBlock 没语言时也跑得通
 * （fallback 到纯文本），但有了之后高亮会更准。
 */
function guessLanguageFromUrl(url: string): string | undefined {
  let path = url;
  const hash = path.indexOf("#");
  if (hash !== -1) path = path.slice(0, hash);
  const q = path.indexOf("?");
  if (q !== -1) path = path.slice(0, q);
  const lastSlash = path.lastIndexOf("/");
  const lastSeg = lastSlash === -1 ? path : path.slice(lastSlash + 1);
  const dot = lastSeg.lastIndexOf(".");
  if (dot === -1 || dot === lastSeg.length - 1) return undefined;
  return lastSeg.slice(dot + 1).toLowerCase();
}