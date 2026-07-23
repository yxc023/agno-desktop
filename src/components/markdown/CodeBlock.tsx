import { useCallback, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, copyToClipboard } from "@/lib/utils";
import { useHighlight } from "@/hooks/use-highlight";

interface Props {
  language?: string;
  /**
   * Markdown 渲染路径：react-markdown 解析后的原始文本。
   * CodeBlock 会在 Web Worker 里异步高亮；高亮未到之前显示纯文本。
   */
  children?: string;
  /**
   * 已 JSON.stringify 好的字符串（ToolCallCard / ApprovalDialog 等）。
   * 这种情况下不调 worker，直接纯文本渲染（避免对 JSON 字符串做语法高亮）。
   */
  value?: string;
  className?: string;
}

/**
 * CodeBlock — 代码块容器。
 *
 * ## 高亮策略
 * - Markdown 路径传 `children`（原始文本）→ useHighlight → worker → dangerouslySetInnerHTML
 * - 工具卡片路径传 `value`（已 stringify 的 JSON）→ 不高亮，原文渲染
 *
 * 高亮未到达前显示 plain text；worker 通常 < 50ms 响应，所以视觉上几乎
 * 看不到"无高亮"状态（除非 block 特别长）。
 *
 * Copy 按钮复制纯文本；markdown 路径从 children 拿，tool 卡片路径从 value 拿。
 */
export function CodeBlock({ language, children, value, className }: Props) {
  const [copied, setCopied] = useState(false);

  const rawText = children ?? value ?? "";
  const isMarkdownPath = children !== undefined && value === undefined;

  // worker 缓存 key —— 同一 (text, language) 跨 session 复用高亮结果
  const cacheKey = useMemo(
    () => `${language ?? "text"}:${rawText.length}:${hash32(rawText)}`,
    [language, rawText]
  );
  const { html, status } = useHighlight(
    rawText,
    language ?? "",
    cacheKey
  );

  const onCopy = useCallback(async () => {
    if (!rawText) return;
    const ok = await copyToClipboard(rawText);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [rawText]);

  // 高亮可用 → dangerouslySetInnerHTML；否则纯文本 fallback
  const codeClass = `language-${language || "text"}`;
  const isPending = isMarkdownPath && status === "pending" && html === null;

  return (
    <div
      className={cn(
        "group relative my-3 overflow-hidden rounded-lg border bg-[#0d1117] dark:bg-[#0d1117]",
        className
      )}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 bg-white/[0.02]">
        <span className="text-[11px] font-mono text-zinc-400 lowercase">
          {language || "text"}
          {isPending && (
            <span className="ml-2 text-zinc-500 italic">highlighting…</span>
          )}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onCopy}
          disabled={!rawText}
          className="h-6 w-6 text-zinc-400 hover:text-zinc-100 hover:bg-white/10 disabled:opacity-40"
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12.5px] leading-relaxed font-mono text-zinc-100">
        {html ? (
          <code
            className={codeClass}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <code className={codeClass}>{rawText}</code>
        )}
      </pre>
    </div>
  );
}

/** 32-bit FNV-1a hash —— 缓存 key 用，不要用于安全场景。 */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}