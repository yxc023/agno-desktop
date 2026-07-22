/**
 * MarkdownStream — 流式 markdown 渲染器
 *
 * ## 设计动机
 * 原始的 `<Markdown>` 在每个 stream chunk 时都会被 React 重新渲染，导致
 * `react-markdown` 重新解析整段 markdown。
 *
 * ## 策略（v2）
 * **始终**走 markdown parse + `remend` 治愈不完整的 markdown 语法（`**bold`
 * 流式中途可能还没闭合）。不再有 plain-text tail —— 上一版的"短单行消息
 * 整段进 tail → `**text**` 显示成原文"的视觉 bug 由此修复。
 *
 * `remend` 借鉴自 OpenCode (`packages/session-ui/src/components/markdown-stream.ts:48-50`):
 *   - `**bold`        → `**bold**`
 *   - `[link](http`   → `link text`  (linkMode: "text-only")
 *   - `` `code ``     → `` `code` ``
 * 完整 markdown 不变，零成本。
 *
 * ## 性能合约
 * - React.memo(Markdown) 在 chunk 之间如果 children 不变就跳过（streaming cursor 视觉）
 * - Markdown 自身用 React.memo 包装 + raw 比较（已存在）
 * - 不做 prefix/tail 二分 + 不做 token-level cache（OpenCode 的 morphdom 路线）——
 *   留给后续迭代。当前 streaming 主线程 parse 时间在大多数场景下可接受。
 *
 * ## 与"已知简化"的关系
 * 旧版 v1 用 prefix/tail 二分：tail 是 plain text，目的是避免"半截 fence"视觉错乱。
 * 但这个策略在**短单行消息**上完全退化（找不到 \n\n 边界 → 整段进 tail → `**` 显示
 * 成原文）。v2 用 remend 直接治愈，从根本上消除这个 corner case。
 */

import { memo } from "react";
import remend from "remend";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";

interface Props {
  /** 文本内容 */
  children: string;
  /** 当前是否处于流式输出。仅影响 streaming cursor 视觉，**不影响** markdown parse 路径。 */
  streaming?: boolean;
  className?: string;
}

export const MarkdownStream = memo(function MarkdownStream({
  children,
  streaming = false,
  className,
}: Props) {
  // remend 对完整 markdown 是 no-op，对不完整语法（流式中途）自动补全。
  // linkMode: "text-only" 让残缺 link 在 streaming 阶段降级为纯文本，避免
  // 用户看到 "[text](htt..." 这种半截 URL 闪烁。
  const healed = remend(children ?? "", { linkMode: "text-only" });

  return (
    <div className={cn("relative", className)}>
      <Markdown streaming={streaming}>{healed}</Markdown>
      {streaming && (
        <span
          aria-hidden
          className="streaming-cursor pointer-events-none ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] bg-current opacity-70"
        />
      )}
    </div>
  );
});