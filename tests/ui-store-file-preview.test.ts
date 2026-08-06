/**
 * Tests for ui-store file preview panel state.
 *
 * Verifies:
 *  - previewFile opens the panel and creates a new tab
 *  - previewFile reuses an existing tab for the same (sessionId, url)
 *  - tabs are scoped by sessionId (same URL in different sessions = 2 tabs)
 *  - panel toggle is independent of tabs list
 *  - closeFileTab keeps other tabs and updates active tab correctly
 *  - setTabLoaded flips state from loading → loaded
 *  - setTabError flips state to error
 *  - selecting a tab updates activeFileTabId
 *  - FilePreviewKind is set from the argument
 *
 * Usage:
 *   bun run test (or) bun run tests/ui-store-file-preview.test.ts
 */
import { useUIStore } from "../src/stores/ui-store";

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed++;
    console.error(`✗ ${msg}`);
  } else {
    console.log(`✓ ${msg}`);
  }
}

function reset() {
  // Clean slate between test groups
  useUIStore.setState({
    filePreviewPanelOpen: false,
    filePreviewTabs: [],
    activeFileTabId: null,
  });
}

async function main(): Promise<void> {
  // ───────────────────── previewFile opens panel + creates tab ─────────────────────
  {
    reset();
    useUIStore.getState().previewFile("sess-1", "https://example.com/a.md", "md");
    const s = useUIStore.getState();
    assert(s.filePreviewPanelOpen === true, "previewFile: opens panel");
    assert(s.filePreviewTabs.length === 1, `previewFile: creates 1 tab (got ${s.filePreviewTabs.length})`);
    assert(s.activeFileTabId === s.filePreviewTabs[0].id, "previewFile: activates new tab");
    const t = s.filePreviewTabs[0];
    assert(t.sessionId === "sess-1", "previewFile: tab.sessionId = sess-1");
    assert(t.url === "https://example.com/a.md", "previewFile: tab.url preserved");
    assert(t.kind === "md", "previewFile: tab.kind = md");
    assert(t.state === "loading", "previewFile: tab.state = loading");
    assert(typeof t.title === "string" && t.title.length > 0, "previewFile: tab.title derived from url");
    assert(typeof t.createdAt === "number", "previewFile: tab.createdAt is number");
  }

  // ───────────────────── duplicate (sessionId, url) reuses tab ─────────────────────
  {
    reset();
    useUIStore.getState().previewFile("sess-1", "https://example.com/a.md", "md");
    const firstTabId = useUIStore.getState().filePreviewTabs[0].id;
    useUIStore.getState().previewFile("sess-1", "https://example.com/a.md", "md");
    const s = useUIStore.getState();
    assert(s.filePreviewTabs.length === 1, "duplicate previewFile: tab reused (length=1)");
    assert(s.activeFileTabId === firstTabId, "duplicate previewFile: active unchanged");
  }

  // ───────────────────── same URL different session = 2 tabs ─────────────────────
  {
    reset();
    useUIStore.getState().previewFile("sess-1", "https://example.com/a.md", "md");
    useUIStore.getState().previewFile("sess-2", "https://example.com/a.md", "md");
    const s = useUIStore.getState();
    assert(s.filePreviewTabs.length === 2, `same URL different session: 2 tabs (got ${s.filePreviewTabs.length})`);
    assert(s.filePreviewTabs[0].sessionId === "sess-1", "tab[0].sessionId = sess-1");
    assert(s.filePreviewTabs[1].sessionId === "sess-2", "tab[1].sessionId = sess-2");
  }

  // ───────────────────── active tab moves on subsequent previewFile ─────────────────────
  {
    reset();
    useUIStore.getState().previewFile("sess-1", "https://example.com/a.md", "md");
    const firstId = useUIStore.getState().filePreviewTabs[0].id;
    useUIStore.getState().previewFile("sess-1", "https://example.com/b.txt", "text");
    const s = useUIStore.getState();
    assert(s.filePreviewTabs.length === 2, "second preview: 2 tabs");
    assert(s.activeFileTabId !== firstId, "second preview: active moved to new tab");
    assert(s.activeFileTabId === s.filePreviewTabs[1].id, "active = newest tab");
  }

  // ───────────────────── panel toggle is independent of tabs ─────────────────────
  {
    reset();
    useUIStore.getState().previewFile("sess-1", "https://example.com/a.md", "md");
    assert(useUIStore.getState().filePreviewPanelOpen === true, "previewFile opens panel");
    useUIStore.getState().closeFilePreviewPanel();
    const s = useUIStore.getState();
    assert(s.filePreviewPanelOpen === false, "closeFilePreviewPanel: hidden");
    assert(s.filePreviewTabs.length === 1, "closeFilePreviewPanel: tabs preserved");
    useUIStore.getState().openFilePreviewPanel();
    assert(useUIStore.getState().filePreviewPanelOpen === true, "openFilePreviewPanel: visible");
    assert(useUIStore.getState().filePreviewTabs.length === 1, "openFilePreviewPanel: tabs preserved");
  }

  // ───────────────────── toggleFilePreviewPanel flips state ─────────────────────
  {
    reset();
    assert(useUIStore.getState().filePreviewPanelOpen === false, "toggle: starts closed");
    useUIStore.getState().toggleFilePreviewPanel();
    assert(useUIStore.getState().filePreviewPanelOpen === true, "toggle: → open");
    useUIStore.getState().toggleFilePreviewPanel();
    assert(useUIStore.getState().filePreviewPanelOpen === false, "toggle: → closed");
  }

  // ───────────────────── closeFileTab removes one tab, keeps others ─────────────────────
  {
    reset();
    useUIStore.getState().previewFile("sess-1", "https://example.com/a.md", "md");
    useUIStore.getState().previewFile("sess-1", "https://example.com/b.txt", "text");
    useUIStore.getState().previewFile("sess-1", "https://example.com/c.json", "code");
    const ids = useUIStore.getState().filePreviewTabs.map((t) => t.id);
    useUIStore.getState().closeFileTab(ids[1]); // close middle
    const s = useUIStore.getState();
    assert(s.filePreviewTabs.length === 2, `closeFileTab middle: length=2 (got ${s.filePreviewTabs.length})`);
    assert(s.filePreviewTabs.find((t) => t.id === ids[1]) == null, "closed tab is gone");
    assert(s.filePreviewTabs.find((t) => t.id === ids[0]) != null, "tab[0] preserved");
    assert(s.filePreviewTabs.find((t) => t.id === ids[2]) != null, "tab[2] preserved");
  }

  // ───────────────────── closeFileTab on active tab moves active ─────────────────────
  {
    reset();
    useUIStore.getState().previewFile("sess-1", "https://example.com/a.md", "md");
    useUIStore.getState().previewFile("sess-1", "https://example.com/b.txt", "text");
    const ids = useUIStore.getState().filePreviewTabs.map((t) => t.id);
    assert(useUIStore.getState().activeFileTabId === ids[1], "active is tab[1]");
    useUIStore.getState().closeFileTab(ids[1]);
    const s = useUIStore.getState();
    assert(s.activeFileTabId === ids[0], "active moves to tab[0] when closing tab[1]");
  }

  // ───────────────────── closeFileTab on last tab clears active ─────────────────────
  {
    reset();
    useUIStore.getState().previewFile("sess-1", "https://example.com/a.md", "md");
    const onlyId = useUIStore.getState().filePreviewTabs[0].id;
    useUIStore.getState().closeFileTab(onlyId);
    const s = useUIStore.getState();
    assert(s.filePreviewTabs.length === 0, "closeFileTab: tabs empty");
    assert(s.activeFileTabId === null, "closeFileTab: active = null");
  }

  // ───────────────────── closeFileTab on missing id is no-op ─────────────────────
  {
    reset();
    useUIStore.getState().previewFile("sess-1", "https://example.com/a.md", "md");
    const before = useUIStore.getState().filePreviewTabs.length;
    useUIStore.getState().closeFileTab("nonexistent-id");
    const after = useUIStore.getState().filePreviewTabs.length;
    assert(before === after, "closeFileTab on missing id: no-op");
  }

  // ───────────────────── selectFileTab updates activeFileTabId ─────────────────────
  {
    reset();
    useUIStore.getState().previewFile("sess-1", "https://example.com/a.md", "md");
    useUIStore.getState().previewFile("sess-1", "https://example.com/b.txt", "text");
    const ids = useUIStore.getState().filePreviewTabs.map((t) => t.id);
    useUIStore.getState().selectFileTab(ids[0]);
    assert(useUIStore.getState().activeFileTabId === ids[0], "selectFileTab: active = tab[0]");
  }

  // ───────────────────── setTabLoaded flips loading → loaded ─────────────────────
  {
    reset();
    useUIStore.getState().previewFile("sess-1", "https://example.com/a.md", "md");
    const id = useUIStore.getState().filePreviewTabs[0].id;
    useUIStore.getState().setTabLoaded(id, "# hi", "text/markdown");
    const t = useUIStore.getState().filePreviewTabs[0];
    assert(t.state === "loaded", `setTabLoaded: state = loaded (got ${t.state})`);
    assert(t.content === "# hi", "setTabLoaded: content stored");
    assert(t.mime === "text/markdown", "setTabLoaded: mime stored");
  }

  // ───────────────────── setTabError flips to error ─────────────────────
  {
    reset();
    useUIStore.getState().previewFile("sess-1", "https://example.com/a.md", "md");
    const id = useUIStore.getState().filePreviewTabs[0].id;
    useUIStore.getState().setTabError(id, "boom");
    const t = useUIStore.getState().filePreviewTabs[0];
    assert(t.state === "error", "setTabError: state = error");
    assert(t.error === "boom", "setTabError: error message stored");
  }

  // ───────────────────── tab id is stable across re-preview ─────────────────────
  {
    reset();
    useUIStore.getState().previewFile("sess-1", "https://example.com/a.md", "md");
    const id1 = useUIStore.getState().filePreviewTabs[0].id;
    useUIStore.getState().setTabLoaded(id1, "x", "text/markdown");
    // re-preview same URL → should NOT create a new tab; should reset state to loading
    useUIStore.getState().previewFile("sess-1", "https://example.com/a.md", "md");
    const s = useUIStore.getState();
    assert(s.filePreviewTabs.length === 1, "re-preview: still 1 tab");
    assert(s.filePreviewTabs[0].id === id1, "re-preview: same id");
    assert(s.filePreviewTabs[0].state === "loading", "re-preview: state reset to loading (re-fetch)");
  }

  // ───────────────────── title is derived from URL path basename ─────────────────────
  {
    reset();
    useUIStore.getState().previewFile("sess-1", "https://example.com/path/to/notes.md", "md");
    assert(useUIStore.getState().filePreviewTabs[0].title === "notes.md", `title basename: ${useUIStore.getState().filePreviewTabs[0].title}`);
    useUIStore.getState().previewFile("sess-1", "https://example.com/", "text");
    // no path → title falls back to full URL (or hostname)
    assert(typeof useUIStore.getState().filePreviewTabs[1].title === "string" && useUIStore.getState().filePreviewTabs[1].title.length > 0, "title fallback: non-empty");
  }

  // ───────────────────── regression: stable reference across unrelated state changes ─────────────────
  // 早期版本把 .filter() 放进 zustand selector，每次返回新数组让
  // useSyncExternalStore 误判 snapshot 变了、无限 re-render。这里 pin
  // 住 zustand 的契约：raw `filePreviewTabs` 引用在 tabs 未变时必须稳定。
  {
    reset();
    useUIStore.getState().previewFile("sess-1", "https://example.com/a.md", "md");
    const ref1 = useUIStore.getState().filePreviewTabs;
    // 触发 panel toggle —— 不应改 filePreviewTabs 引用
    useUIStore.getState().toggleFilePreviewPanel();
    const ref2 = useUIStore.getState().filePreviewTabs;
    assert(ref1 === ref2, "filePreviewTabs reference stable across unrelated state changes");
  }

  console.log(
    `\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});