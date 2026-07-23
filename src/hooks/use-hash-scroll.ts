/**
 * useHashScroll — 把 #message-<id> URL hash 解析成"目标 message id"。
 *
 * 监听 location.hash 变化（popstate + 直接设的 hash）；
 * 调用方传入当前 messages 列表，从 #message-X 中匹配。
 *
 * 设计参考 OpenCode `use-session-hash-scroll.ts` 的核心协议（hash ↔
 * active message 双向同步），但简化为"hash → message id"单向 hook：
 *   - 把当前 hash 里的目标 id 解出来（如果当前 hash 不是 #message- 形式，返回 null）
 *   - popstate 时重读（用户粘贴 URL / 后退前进）
 *
 * "active message → hash" 的反向同步放在 VirtualMessageList 的
 * onActiveMessageChange 里。
 */

import { useEffect, useRef, useState } from "react";

const HASH_PREFIX = "#message-";

function parseHash(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith(HASH_PREFIX)) return null;
  const id = raw.slice(HASH_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

const defaultGetHash = () =>
  typeof window !== "undefined" ? window.location.hash : null;

const defaultSubscribe = (cb: () => void): (() => void) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
};

export interface UseHashScrollOptions {
  /**
   * 显式传 window.location.hash 的源；测试可注入 mock。默认读 window.location.hash。
   */
  getHash?: () => string | null | undefined;
  /** 显式 listen 接口；测试可注入 mock。默认 addEventListener('popstate')。 */
  subscribe?: (cb: () => void) => () => void;
}

export function useHashScroll(options: UseHashScrollOptions = {}): string | null {
  // 把可变的 getHash / subscribe 包成 ref；effect 只跑一次。
  const getHashRef = useRef(options.getHash ?? defaultGetHash);
  const subscribeRef = useRef(options.subscribe ?? defaultSubscribe);
  // 切换 source 时同步 ref（一般不会变；但允许外部动态注入）
  getHashRef.current = options.getHash ?? defaultGetHash;
  subscribeRef.current = options.subscribe ?? defaultSubscribe;

  const [target, setTarget] = useState<string | null>(() => parseHash(getHashRef.current()));

  useEffect(() => {
    const update = () => setTarget(parseHash(getHashRef.current()));
    const unsub = subscribeRef.current(update);
    const onHashChange = () => update();
    window.addEventListener("hashchange", onHashChange);
    return () => {
      unsub();
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  return target;
}

/**
 * 把消息 id 写到 location.hash，不留 history entry。
 *
 * - 当前 hash 已经是目标 → no-op
 * - 当前 hash 是其他 message → replaceState（不增加 history）
 * - 当前 hash 是非 message 形式（#foo）→ replaceState 成 #message-<id>
 * - 当前 hash 为空 → 不写（保持 URL 干净）
 */
export function writeMessageHash(
  messageId: string,
  options: { getHash?: () => string | null | undefined; replace?: typeof history.replaceState } = {}
): void {
  writeMessageHashInner(messageId, options);
}

function writeMessageHashInner(
  messageId: string,
  options: { getHash?: () => string | null | undefined; replace?: typeof history.replaceState } = {}
): void {
  const getHash = options.getHash;
  const replace = options.replace;
  const cur = getHash ? getHash() : null;
  const target = `${HASH_PREFIX}${messageId}`;
  if (cur === target) return;
  // 只在用户已经在 message hash 上时覆盖；空 hash 不要强行加（避免打扰分享干净的 URL）
  if (!cur || !cur.startsWith(HASH_PREFIX)) return;
  const r = replace ?? history.replaceState.bind(history);
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const search = typeof window !== "undefined" ? window.location.search : "";
  r(null, "", `${path}${search}${target}`);
}

/** 测试导出：直接调内部版本，避免依赖 window。 */
export function writeMessageHashForTest(
  messageId: string,
  options: { getHash?: () => string | null | undefined; replace?: typeof history.replaceState } = {}
): void {
  writeMessageHashInner(messageId, options);
}

/** 测试导出：parseHash 提取。 */
export function parseHashForTest(
  raw: string | null | undefined
): string | null {
  return parseHash(raw);
}