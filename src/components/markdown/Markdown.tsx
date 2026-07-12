import { Fragment, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
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

export function Markdown({ children, className, streaming }: Props) {
  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-h1:text-lg prose-h2:text-base prose-h3:text-sm",
        "prose-p:leading-relaxed prose-p:my-2",
        "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
        "prose-hr:my-2 prose-hr:border-border",
        "prose-pre:my-0 prose-pre:p-0 prose-pre:bg-transparent",
        "prose-code:before:content-none prose-code:after:content-none",
        "prose-blockquote:border-l-2 prose-blockquote:border-border prose-blockquote:pl-3 prose-blockquote:italic",
        "prose-table:text-sm",
        "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
        streaming && "streaming-cursor",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeRaw, [rehypeHighlight, { detect: true }]]}
        components={{
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

            // block code：把 children（已经是 hljs token span 树）原样传给 CodeBlock，
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
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}