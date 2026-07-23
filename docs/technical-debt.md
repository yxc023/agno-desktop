# Technical Debt — Chat Streaming UX (`feature/chat-streaming-ux`)

> Known limits / sharp edges deferred from the chat-streaming-ux branch
> (commits `fb3d904` … `9f2c1e2`). Each item: what, why-not-now, what would
> unblock it. Severity is **rough** — *prob* means "in real-world usage
> how often does this bite", not statistical.

## Feature gaps

### TD-1 · History pagination — no `loadMore` action
- **What**: `loadHistory` fetches only the first page (size 20-ish). The
  `#message-<id>` deep-link silently no-ops for any message beyond that
  window — `scrollToMessageId` finds no row to scroll to.
- **Prob**: high for any session past 20 messages; users who share a `#message-…`
  URL on long sessions hit it every time.
- **Blocked by**: AGNO backend pagination API. Our `/sessions/{id}/runs` endpoint
  doesn't expose a cursor yet — we'd need a separate trace or rely on incremental
  event-stream replay.
- **Unblock**: AGNO API cursor support → add `loadMore(sessionId, cursor?)` to
  `chat-store.loadHistory`, `VirtualMessageList` detects "scroll-to-target not
  loaded" and triggers pagination until found or end-of-history.

### TD-7 · Highlight worker first-time language waterfall
- **What**: `markdown-shiki.worker.ts` lazy-loads languages inside the worker.
  Multiple parallel first-time requests on different languages each await their
  own `instance.loadLanguage()` independently. User sees plain text for longer than
  necessary when a session opens with mixed-language code blocks (rare but observable
  on a slow machine).
- **Prob**: low (only on first encounter per language).
- **Fix**: per-language promise cache inside worker — `Map<string, Promise<void>>`,
  `loadLanguage(lang) → cached promise`.

## Correctness / race sharp edges

### TD-5 · `expectSelfWriteHash` race with popstate
- **Where**: `src/hooks/use-hash-scroll.ts`, module-level
  `expectedSelfWriteHash` consumed in the `hashchange` listener.
- **Symptom**: a hashchange that *happens to match* the value just written by
  `writeMessageHash({ silent: true })` is silently consumed. In dev / busy users:
  clicking browser back right after auto-tracking wrote a hash drops the popstate.
- **Prob**: rare (timing-window dependent). Test with `dispatchEvent(new HashChangeEvent(...))`
  in the same tick as `writeMessageHash({silent:true})`.
- **Fix (idea)**: tie `expectedSelfWriteHash` to user-input events
  (`mousedown` / `keydown` / `popstate` itself) for early invalidation; or use a
  monotonically-increasing generation counter instead of value equality.

### TD-6 · Shadow map keyed by `partIndex` breaks on inter-part inserts
- **Where**: `src/lib/chat-buffer.ts` —
  `shadowTextByMessage = Map<messageId, Map<partIndex, text>>`
- **Issue**: if runner inserts a new part between two existing text parts
  (e.g., tool-output rendered between two prose segments), indices shift;
  `mergeShadowIntoMessage` compares wrong parts.
- **Prob**: low in current AGNO behaviour (parts are emitted in order; tool
  outputs append, never interleave with prior text). Verified by inspection of
  `src/lib/chat-runner.ts` — no interleaving paths exercised today.
- **Fix**: assign stable `id` to each `TextPart` at runner-creation time;
  shadow keyed by `partId` (string), immune to index shifts.

### TD-9 · `AutoScrollController.auto-snapping` × user-wheel race
- **Where**: `src/lib/auto-scroll-controller.ts:42-66` — `handleWheel`
  accepts the wheel but state stays `auto-snapping` until snap-window
  expires; only then does a subsequent `handleScroll` transition to
  `user-paused`.
- **Symptom**: brief delay (≤`markAutoMs` = 1500ms) before user's "scroll up"
  is registered when the bottom-snap just happened. User sees content scroll past
  for ~1 frame before pause kicks in.
- **Prob**: rare — user would have to scroll up within 1500 ms of arriving
  content while bottom-snapping.
- **Fix (idea)**: drop `auto-snapping` immediately on `handleWheel(deltaY < 0)`;
  trade-off is one extra wheel noise event breaking snap.

### TD-11 · Strict Mode double-invocation of `setBufferFlushCallback`
- **Where**: `src/lib/chat-buffer.ts:34` (module-level `flushCallback`),
  `src/stores/chat-store.ts` registers once at module-load.
- **Symptom**: in React 18+ Strict Mode dev, `setState` runs effects twice.
  In this codebase the buffer flush callback is *registered* at module import,
  not inside an effect, so Strict Mode doesn't double-register. But the
  `expectedSelfWriteHash` flag (TD-5) *is* a module-level mutable; adjacent
  silent writes plus strict double-firing could see offsets.
- **Prob**: dev-only.
- **Fix**: move flag tracking into a `useRef`-based singleton behind a React
  context provider, or accept the dev quirk.

## Performance / quality

### TD-2 · `VirtualMessageList` itself has no `React.memo`
- **Where**: `src/components/chat/VirtualMessageList.tsx`.
- **Symptom**: re-renders whenever ChatPanel does, even when its inputs
  (`messages`, `scrollRef`, `cacheKey`, `scrollToMessageId`, `onActiveMessageChange`)
  are reference-equal. With messages changing 1×/sec during streaming (already
  coalesced), the redundant renders are cheap but unnecessary.
- **Fix**: `memo(VirtualMessageList, (prev, next) => prev.messages === next.messages && prev.cacheKey === next.cacheKey && prev.scrollRef === next.scrollRef && prev.scrollToMessageId === next.scrollToMessageId && prev.onActiveMessageChange === next.onActiveMessageChange)`.

### TD-3 · `jumpToBottom(true)` smooth scroll vs content growth
- **Where**: `src/hooks/use-auto-scroll.ts:90-93` calls `el.scrollTo({behavior: 'smooth'})`.
- **Symptom**: if content grows during the ~300 ms smooth animation, the
  original target height is stale → scroll lands at the OLD bottom, exposing
  fresh content below. MO-driven re-snap usually fixes this within one frame
  but the user perceives a momentary "drift past" effect.
- **Prob**: visible only when user clicks "back to bottom" during heavy
  streaming burst.
- **Fix (idea)**: instant scroll (`behavior: 'auto'`) since smooth is rarely
  desirable for "jump to bottom"; or re-trigger snap each rAF during animation.

### TD-10 · URL hash never written on fresh chat session
- **Where**: `src/hooks/use-hash-scroll.ts:41` — `writeMessageHash` no-ops
  when URL hash is empty (avoids polluting clean share URLs).
- **Trade-off**: first scroll in a fresh session does NOT persist URL;
  reload loses position. Acceptable for the "share URL → scroll-to-X" use case
  but contradicts the "scroll restoration across reload" promise of TD-1.
- **Fix (idea)**: persist via `sessionStorage` (per-session, not URL-share)
  as the reload-restoration source. URL hash remains reserved for deep-links.

## Architecture notes (not bugs, just sharp edges to know)

- **`useHashScroll` moduels state**: `expectedSelfWriteHash` and `flushCallback`
  in `chat-buffer.ts` are module-level singletons. Fine for single-store
  apps; problematic if anyone ever wraps two chat-store instances. Document
  rather than fix.

- **`TimelineCache` LRU 16 entries per process**: cross-session cache. Lives
  for the page lifetime. Memory cost per entry is the array of measured
  heights × entry count. Negligible in practice; bump the cap if any
  session exceeds 16 over time.

- **`setBufferFlushCallback` not in an `useRef`**: callback is closed over
  `store.setState` (Zustand API). If `chat-store` ever imports `chat-buffer`
  in a different order, the callback would be set before `store` is
  defined — current order in `chat-store.ts` is correct (callback at end of
  module, after `useChatStore = create(...)`). Reorder risky; document.

---

## Severity table

| ID | One-line | Prob | Severity | Status |
|----|----------|------|----------|--------|
| TD-1 | History pagination missing | High | High | API-blocked |
| TD-2 | VirtualMessageList no memo | Medium | Low | Note |
| TD-3 | jumpToBottom smooth vs grow race | Low | Low | Note |
| TD-5 | popstate eaten by expectedSelfWriteHash | Low | Low | Note |
| TD-6 | Shadow partIndex shifts on interleave | Low | Medium | System review |
| TD-7 | Highlight language waterfall | Low | Low | Note |
| TD-9 | auto-snapping × user-wheel race | Low | Low | Note |
| TD-10 | No URL persistence on fresh session | Medium | Low | Note |
| TD-11 | Strict Mode × silent flag | Low | Dev-only | Note |
