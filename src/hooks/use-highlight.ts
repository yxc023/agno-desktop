import { useEffect, useState } from "react";
import { getHighlightClient } from "@/lib/highlight-client";

interface State {
  html: string | null;
  status: "pending" | "ready" | "error";
}

/**
 * useHighlight — 给 code + language 返回 highlighted HTML。
 *
 * 行为：
 *   - 首次渲染 → 查客户端缓存；命中 → status="ready" 直接返回 html
 *   - 未命中 → status="pending"（html=null），发出 worker 请求
 *   - worker 响应 → setState → 重渲染 → status="ready"
 *   - 卸载时：客户端内部 supersede 机制让旧请求的 response 被丢弃
 *     （component 不需要主动 cancel）
 */
export function useHighlight(
  code: string,
  language: string,
  cacheKey: string
): State {
  const [state, setState] = useState<State>(() => ({
    html: null,
    status: "pending",
  }));

  useEffect(() => {
    let cancelled = false;
    setState({ html: null, status: "pending" });
    getHighlightClient()
      .request(code, language, cacheKey)
      .then((html) => {
        if (cancelled) return;
        setState({ html, status: "ready" });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        console.warn("highlight worker failed", err);
        setState({ html: null, status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [code, language, cacheKey]);

  return state;
}