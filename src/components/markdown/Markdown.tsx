import { Fragment, memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";
import { openExternalUrl } from "@/lib/open-external-url";

interface Props {
  children: string;
  className?: string;
  /** 当文本正在流式追加时，给最后字符加 cursor 动画 */
  streaming?: boolean;
}

// React 19 拒绝渲染不带连字符的未知 HTML tag，console 抛：
//   "The tag <think> is unrecognized in this browser"
// 某些 reasoning model（DeepSeek R1 / Qwen QwQ / 自行拼 XML 的 agent）
// 在 messages[].content 里直接吐 <think>...</think> 而不是走 AGNO 的
// reasoning_content event——rehype-raw 把它当 HTML 元素透传给 React 就炸。
// 这里 override 成 <details>：可折叠、不污染主对话流、不需要额外依赖。
// Components 类型只允许已知 HTML tag，所以 think 用 `Components & { think?: ... }`
// 拓展一下，保留其他 overrides 的类型检查。
const markdownComponents: Components & {
  think?: (props: { children?: ReactNode }) => ReactNode;
} = {
  pre({ children }) {
    // rehype-highlight 已经在 pre 里包裹了 code，
    // 直接把 children 透传给我们的 code 渲染管线，避免多套一层无意义 fragment
    return <Fragment>{children}</Fragment>;
  },
  code({ className: cls, children, node: _node, ...props }) {
    // 关键修复（修复前是 `String(children)`，会把 rehype-highlight 产生的
    // `<span>` 元素数组序列化成 "[object Object],[object Object],..."，
    // 导致代码块里出现一串 "[object Object]" 字样）。
    //
    // 检测 block vs inline：用 className 里有没有 `language-*` 区分。
    //   - 旧 `isInline = !props.node?.position` 永远为 false（两种 code 都
    //     有 position），结果 inline 也走 CodeBlock 路径——只是因为 inline
    //     的 children 是 string，`String("code")` 偶然没坏。
    //   - rehype-highlight + `detect: true` 总会给 fenced block 加上
    //     `language-xxx` 类（要么显式、要么自动识别），inline 永远没有。
    //     所以 className 是最可靠的区分依据。
    const langMatch = /language-(\w+)/.exec(cls || "");
    const language = langMatch?.[1];

    if (!language) {
      // inline code：直接渲染子节点（highlight.js 不处理 inline）
      return (
        <code
          className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-[0.85em]"
          {...props}
        >
          {children}
        </code>
      );
    }

    // block code：把 children（已经是 hljs token span 树）原样传给 CodeBlock,
    // 保留高亮。CodeBlock 自己会用 extractText(children) 拿到纯文本做"复制"。
    return (
      <CodeBlock language={language}>{children as ReactNode}</CodeBlock>
    );
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          // Tauri Webview 默认拦截 target=_blank，要么在 webview 内
          // 开新 tab 要么静默失败。preventDefault 后调 shell.open
          // 走系统默认浏览器，体验与"普通浏览器"一致。
          // 保留 href + target 让 dev 工具 / 浏览器环境（裸 vite）
          // 仍能 hover/copy/中键新窗口打开。
          e.preventDefault();
          e.stopPropagation();
          void openExternalUrl(href);
        }}
      >
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto my-3">
        <table className="w-full text-sm">{children}</table>
      </div>
    );
  },
  think({ children }) {
    return (
      <div className="my-2 whitespace-pre-wrap rounded bg-muted/40 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    );
  },
};

/**
 * Markdown — 把 markdown 字符串渲染成 HTML。
 *
 * 性能合约（性能优化 round 1）：
 * - 用 `React.memo` 包装：props 完全 shallow-equal 时**跳过整次 render**，
 *   避免在 ChatPanel 整体重 render 时连带重新解析已确定不变的 markdown。
 *   这是 streaming 期间的关键优化 —— ChatPanel 每次接 chunk 都会 rerender
 *   → 之前会让所有 message 的 markdown 都重 parse → 主线程吃满。
 * - props 故意保持简单（children / className / streaming 都是 primitive
 *   类型），React.memo 的默认浅比较足够；不需要自定义 areEqual。
 *
 * 进一步优化：流式场景下应使用 `<MarkdownStream>` —— 它会把 markdown 切为
 * 「稳定 prefix」+「实时 tail」，让本组件在最坏情况也只重 parse 增量段落。
 */
export const Markdown = memo(function Markdown({
  children,
  className,
  streaming,
}: Props) {
  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-h1:text-xl prose-h1:mt-6 prose-h1:mb-3",
        "prose-h2:text-lg prose-h2:mt-5 prose-h2:mb-2",
        "prose-h3:text-base prose-h3:mt-4 prose-h3:mb-1.5",
        "prose-p:leading-relaxed prose-p:my-2",
        "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
        "prose-hr:my-3 prose-hr:border-border",
        "prose-pre:my-0 prose-pre:p-0 prose-pre:bg-transparent",
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-blockquote:border-l-2 prose-blockquote:border-border prose-blockquote:pl-3 prose-blockquote:not-italic prose-blockquote:text-foreground/85",
        "prose-table:text-sm",
        "prose-thead:border-b prose-thead:border-border",
        "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
        streaming && "streaming-cursor",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeRaw, [rehypeHighlight, { detect: true }]]}
        components={markdownComponents}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});