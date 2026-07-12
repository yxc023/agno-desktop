import {
  Children,
  isValidElement,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, copyToClipboard } from "@/lib/utils";

interface Props {
  language?: string;
  /**
   * 纯文本内容。Markdown 渲染路径下不要传——传 `children` 才能保留
   * rehype-highlight 的 token spans。ToolCallCard / ApprovalDialog 这种
   * 已经有 JSON.stringify 好的字符串的地方仍然用 `value`。
   */
  value?: string;
  /**
   * 由 react-markdown 经 rehype-highlight 处理后的 React 子树。
   * 直接渲染可保留 `<span class="hljs-...">` 高亮。
   */
  children?: ReactNode;
  className?: string;
}

/**
 * 从 React 子树递归抽取纯文本。
 *
 * 解决 Markdown 渲染路径的 bug：rehype-highlight 会把 token 包成
 * `<span>` 元素，react-markdown 把它们作为 `children` 传给我们的 `code`
 * 组件；旧的 `String(children)` 会把数组里的 React element 序列化成
 * `[object Object],[object Object],...`，导致代码块里出现一串
 * "[object Object]" 字样。这里递归展开拿到原始文本用于「复制」。
 */
function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join("");
  }
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return extractText(props.children);
  }
  // fragment / portal 之类
  if (typeof node === "object" && "props" in (node as any)) {
    return extractText((node as any).props?.children);
  }
  return "";
}

export function CodeBlock({ language, value, children, className }: Props) {
  const [copied, setCopied] = useState(false);

  // 复制用的纯文本：优先 value（已经是 string），否则从 children 递归抽取
  const displayText = useMemo(() => {
    if (typeof value === "string") return value;
    return extractText(children);
  }, [value, children]);

  const onCopy = useCallback(async () => {
    if (!displayText) return;
    const ok = await copyToClipboard(displayText);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [displayText]);

  // 渲染内容：children 优先（保留高亮）；否则回落到 value 字符串
  const hasChildren = Children.count(children) > 0;
  const renderContent: ReactNode = hasChildren ? children : value ?? "";

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
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onCopy}
          disabled={!displayText}
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
        <code className={`language-${language || "text"}`}>{renderContent}</code>
      </pre>
    </div>
  );
}