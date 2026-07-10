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
            // rehype-highlight 已经在 pre 里包裹了 code
            return <>{children}</>;
          },
          code({ className: cls, children, ...props }) {
            const isInline = !(props as any).node?.position;
            const text = String(children ?? "");
            const langMatch = /language-(\w+)/.exec(cls || "");
            const language = langMatch?.[1];
            if (isInline || !language) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-[0.85em]"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return <CodeBlock language={language} value={text.replace(/\n$/, "")} />;
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