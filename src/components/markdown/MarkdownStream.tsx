/**
 * MarkdownStream — 流式 markdown 渲染器
 *
 * ## 设计动机
 * 原始的 `<Markdown>` 在每个 stream chunk 时都会被 React 重新渲染，导致
 * `react-markdown` 重新解析整段 markdown：
 *   - 重新 tokenize
 *   - 重新构建 parse tree
 *   - rehype-highlight 用 `detect: true` 对**未闭合**的代码块尝试识别语言
 *     并高亮 — 这是 streaming 阶段的纯浪费
 *
 * ## 三层节流
 *   1. **节流输入文本**：`usePacedValue` 把上游快速增长的值切成 ~24ms 的
 *      节奏释放；snap 到最近的空白/标点，避免"半截 token"。非流式状态
 *      （`streaming=false` 或历史回放）一次性同步，不延迟。
 *   2. **prefix/tail 拆分**（详见 `markdown-stream.ts`）：流式文本切到
 *      「最后一个稳定段落/fence 边界」为止；之前部分走完整 `<Markdown>`，
 *      之后部分当作 plain text + streaming cursor。
 *   3. **React.memo**：下游 `<Markdown>` / `<span>` 在 shown 不变时跳过 render。
 *
 * ## Tail 渲染
 * tail 不是 markdown，避免出现「半截 fence」/「半截 list」语法混入渲染。
 *
 * ## 已知简化（先 ship，后续可优化）
 *   - tail 用 plain text（保留换行），不解析任何 markdown（避免 fence 半截）
 *   - prefix 的 markdown 解析结果不缓存（每次 prefix 变化都重 parse）
 *     OpenCode 用 morphdom + memoization 实现了 block-level cache。
 *     我们的 prefix 已经是 streaming 的最小完整段落，parse 工作量很小，
 *     不上 morphdom 反而更易维护。
 */

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import {
  splitStreamingMarkdown,
  shouldSkipSplit,
} from "./markdown-stream";
import { usePacedValue } from "@/hooks/use-paced-value";

interface Props {
  /** 文本内容 */
  children: string;
  /** 当前是否处于流式输出。流式时启用 prefix/tail 拆分；非流式时整段一次性渲染。 */
  streaming?: boolean;
  className?: string;
}

function escapeText(s: string): string {
  // 把纯文本里可能影响 plain-text 容器的字符转义；
  // 我们用 whitespace-pre-wrap 让 \n 直接渲染，不转义换行。
  return s.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const MarkdownStream = memo(function MarkdownStream({
  children,
  streaming = false,
  className,
}: Props) {
  // 流式期间节流释放：每 ~24ms 推一段，snap 到空白/标点。
  // 非流式（streaming=false 或历史回放）→ 一次性跟上，不延迟。
  const pacedText = usePacedValue(
    () => children ?? "",
    { isLive: () => streaming === true }
  );

  const split = useMemo(() => {
    if (!streaming) {
      return { prefix: pacedText ?? "", tail: "" };
    }
    const text = pacedText ?? "";
    if (!text) return { prefix: "", tail: "" };
    if (shouldSkipSplit(text)) {
      return { prefix: "", tail: text };
    }
    return splitStreamingMarkdown(text);
  }, [pacedText, streaming]);

  if (!streaming) {
    return (
      <Markdown className={className} streaming={false}>
        {split.prefix}
      </Markdown>
    );
  }

  if (!split.tail) {
    return (
      <Markdown className={className} streaming={false}>
        {split.prefix}
      </Markdown>
    );
  }

  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none", className)}>
      {split.prefix && (
        <Markdown streaming={false}>{split.prefix}</Markdown>
      )}
      <span className="whitespace-pre-wrap streaming-cursor text-foreground/95">
        {escapeText(split.tail)}
      </span>
    </div>
  );
});
