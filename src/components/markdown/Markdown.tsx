import { Fragment, memo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./CodeBlock";
import { openExternalUrl } from "@/lib/open-external-url";

interface Props {
  children: string;
  className?: string;
  /** 当文本正在流式追加时，给最后字符加 cursor 动画 */
  streaming?: boolean;
}

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
 *
 * ## 代码高亮
 * Code block 的语法高亮走 Web Worker（见 `src/lib/highlight-client.ts` +
 * `src/lib/highlight.worker.ts`）。Markdown 解析阶段**不做高亮**——只识别
 * `language-*` 类，把原始文本交给 `<CodeBlock>`，后者在 effect 里发起
 * worker 请求并用 `dangerouslySetInnerHTML` 替换。这样：
 *   - 主线程不被长 code block 的 tokenize 阻塞；
 *   - streaming 期间 unclosed fence 已经在 prefix/tail 拆分里整段走 tail，
 *     不进 react-markdown → 更不会触发高亮；
 *   - 历史回放：N 个 code block 并行发请求，主线程依旧响应滚动 / hover。
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
        rehypePlugins={[rehypeRaw]}
        components={{
          pre({ children }) {
            return <Fragment>{children}</Fragment>;
          },
          code({ className: cls, children, node: _node, ...props }) {
            // 检测 block vs inline：用 className 里有没有 `language-*` 区分。
            //   - inline 没有 `language-*` 类
            //   - fenced block 总会有（要么显式 ```lang，要么被检测为 plaintext）
            const langMatch = /language-(\w+)/.exec(cls || "");
            const language = langMatch?.[1];

            if (!language) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-[0.85em]"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            // block code：提取原始文本 → 给 CodeBlock；
            // 高亮在 worker 里做（见 CodeBlock.tsx + useHighlight）。
            const rawText = stringifyChildren(children);
            return (
              <CodeBlock language={language}>{rawText}</CodeBlock>
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
});

/**
 * 把 react-markdown 传给 `code` 的 children 拍平成纯文本。
 *
 * 移除了 rehype-highlight 之后，children 就是原始 markdown 文本（数组
 * 或单个字符串）；这里统一成字符串给 CodeBlock，CodeBlock 再交给 worker
 * 高亮。
 */
function stringifyChildren(children: ReactNode): string {
  if (children == null || typeof children === "boolean") return "";
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(stringifyChildren).join("");
  return "";
}