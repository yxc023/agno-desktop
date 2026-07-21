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
 * ## 策略
 * 把 streaming 文本切为两部分（详见 `markdown-stream.ts`）：
 *   - **prefix**：到「最后一个稳定段落/fence 边界」为止（含分隔符）
 *     → 用 `<Markdown>` 正常渲染
 *   - **tail**：prefix 之后的内容
 *     → 当作 plain text 渲染（在容器里加 streaming cursor 样式）
 *
 * 非 streaming 状态下，把整个文本当作 prefix 一次性渲染（行为不变）。
 *
 * ## 增量复用
 * 大多数 stream tick 只往 tail 里加几个字符：
 *   - prefix 不变 → React.memo 跳过 `<Markdown>` 渲染（关键优化）
 *   - 仅 tail 长度变化 → 极快（只是给 textContent 节点设置新值）
 *
 * 跨过段落边界时：
 *   - prefix 长度增加 1 个段落 → `<Markdown>` 重新解析（但只解析到 tail
 *     之前的内容，比原始的全量重 parse 仍省 1-2 个数量级的工作）
 *
 * ## Tail 渲染
 * tail 不是 markdown，避免出现「半截 fence」/「半截 list」语法混入渲染。
 * 视觉上用一个稍暗的 tone + streaming cursor，让用户在视觉上「这块还在
 * stream」与 prefix 已完成的「干净 markdown」形成区分。
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
  const split = useMemo(() => {
    if (!streaming) {
      // 非流式：整段视为 prefix，tail 为空。一次渲染所有内容。
      return { prefix: children ?? "", tail: "" };
    }
    const text = children ?? "";
    if (!text) return { prefix: "", tail: "" };
    if (shouldSkipSplit(text)) {
      // link ref 存在 → 整段视为 tail（统一整段 plain text，避免错配）
      return { prefix: "", tail: text };
    }
    return splitStreamingMarkdown(text);
  }, [children, streaming]);

  // 非流式：直接走完整 Markdown 路径（保留 hljs 等全部能力）
  if (!streaming) {
    return (
      <Markdown className={className} streaming={false}>
        {split.prefix}
      </Markdown>
    );
  }

  // 流式：tail 仍为空 → 整段都是 prefix，正常渲染即可（无 plain-text 尾巴）
  if (!split.tail) {
    return (
      <Markdown className={className} streaming={false}>
        {split.prefix}
      </Markdown>
    );
  }

  // 流式 + 有 tail：
  //   prefix 走 React.memo(Markdown) —— 文本不变就跳过；
  //   tail 是 plain text，带 streaming cursor。
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
