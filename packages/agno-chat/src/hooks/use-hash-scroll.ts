"use client";

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
  getHash?: () => string | null | undefined;
  subscribe?: (cb: () => void) => () => void;
}

export function useHashScroll(options: UseHashScrollOptions = {}): string | null {
  const getHashRef = useRef(options.getHash ?? defaultGetHash);
  const subscribeRef = useRef(options.subscribe ?? defaultSubscribe);
  getHashRef.current = options.getHash ?? defaultGetHash;
  subscribeRef.current = options.subscribe ?? defaultSubscribe;

  const [target, setTarget] = useState<string | null>(() => parseHash(getHashRef.current()));

  useEffect(() => {
    const update = () => {
      const next = parseHash(getHashRef.current());
      if (next === expectedSelfWriteHash) {
        expectedSelfWriteHash = null;
        return;
      }
      expectedSelfWriteHash = null;
      setTarget(next);
    };
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

export function writeMessageHash(
  messageId: string,
  options: {
    getHash?: () => string | null | undefined;
    replace?: typeof history.replaceState;
    silent?: boolean;
  } = {}
): void {
  writeMessageHashInner(messageId, options);
}

let expectedSelfWriteHash: string | null = null;

export function getExpectedSelfWriteHashForTest(): string | null {
  return expectedSelfWriteHash;
}

function writeMessageHashInner(
  messageId: string,
  options: {
    getHash?: () => string | null | undefined;
    replace?: typeof history.replaceState;
    silent?: boolean;
  } = {}
): void {
  const getHash = options.getHash;
  const replace = options.replace;
  const cur = getHash ? getHash() : null;
  const target = `${HASH_PREFIX}${messageId}`;
  if (cur === target) return;
  if (!cur || !cur.startsWith(HASH_PREFIX)) return;
  if (options.silent) {
    expectedSelfWriteHash = target;
  }
  const r = replace ?? history.replaceState.bind(history);
  const path = typeof window !== "undefined" ? window.location.pathname : "";
  const search = typeof window !== "undefined" ? window.location.search : "";
  r(null, "", `${path}${search}${target}`);
}

export function writeMessageHashForTest(
  messageId: string,
  options: {
    getHash?: () => string | null | undefined;
    replace?: typeof history.replaceState;
    silent?: boolean;
  } = {}
): void {
  writeMessageHashInner(messageId, options);
}

export function parseHashForTest(
  raw: string | null | undefined
): string | null {
  return parseHash(raw);
}
