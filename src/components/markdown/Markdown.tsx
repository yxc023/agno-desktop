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
//   "The tag  WoW is unrecognized in this browser"
// 某些 reasoning model（DeepSeek R1 / Qwen QwQ / 自行拼 XML 的 agent）
// 在 messages[].content 里直接吐 thinkable.../thinkable 而不是走 AGNO 的
// reasoning_content event——rehype-raw 把它当 HTML 元素透传给 React 就炸。
//
// 关键陷阱：让 react-markdown 处理 think 的 components override 会产生
// `<p><div>` 非法嵌套（think 是 inline HTML → react-markdown 包成 `<p>`，
// 但 override 返回 `<div>` 是 block）。所以下面用「文本 pre-split」策略：
// 在 Markdown 组件入口用 regex 把 think 段先切出来，单独渲染成块，
// 留下的非 think 部分才进 react-markdown 的 AST。
//
// Components 类型只允许已知 HTML tag，所以 think 的入口走 `Markdown` 外层
// 的 pre-split，不进 components map（这里保留 think override 是兜底——如果
// 数据因为被 react-markdown 提前 strip 或转义，pre-split 没抓到，override
// 也不让 React 抛 unknown-tag 错误）。
const markdownComponents: Components & {
  think?: (props: { children?: ReactNode }) => ReactNode;
} = {
  pre({ children }) {
    return <Fragment>{children}</Fragment>;
  },
  code({ className: cls, children, node: _node, ...props }) {
    const langMatch = /language-(\w+)/.exec(cls || "");
    const language = langMatch?.[1];

    if (!language) {
      return (
        <code
          className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-[0.92em]"
          {...props}
        >
          {children}
        </code>
      );
    }
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
  // 兜底：pre-split 没抓到 think 时，至少不要让 React 19 抛 unknown tag。
  // 实际场景下不会触发；保留只是为了防御性地兼容未来数据形态变化。
  think({ children }) {
    return (
      <div className="my-2 whitespace-pre-wrap rounded bg-muted/40 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    );
  },
};

/**
 * 把 markdown 文本里的 思考块切出来，跟 ReasoningBlock 同款视觉。
 *
 * ## 为什么需要这个切分
 * AGNO 把某些 reasoning model 的输出（DeepSeek R1 / Qwen QwQ / 自行拼 XML
 * 的 agent）原样落到 chat_history 里——``...``. 这种 inline HTML
 * 进 react-markdown 后会被包成 `<p>`；我们想要的最终视觉是一个浅灰圆角块
 * （跟 ReasoningBlock 一致），但 `<div>` 不能合法地嵌在 `<p>` 里。
 *
 * 浏览器看到 `<p><div>` 时会自动闭合 `<p>`，导致布局错乱、用户反馈
 * "格式显示就是有问题"。先在文本层切走，think 部分单独渲染成 block，绕开
 * 这个 inline-HTML 嵌套困境。
 *
 * ## 多行 / 嵌套
 * regex 用 `[\s\S]*?` 非贪婪匹配，自动跨行；切出来的 think 内部还有嵌套
 * markdown（bold/code/link）由内层 `<Markdown>` 再次 parse。
 */
function splitAroundThink(text: string): Array<{ kind: "md" | "think"; content: string }> {
  const parts: Array<{ kind: "md" | "think"; content: string }> = [];
  const re = /<thinking>([\s\S]*?)<\/thinking>/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push({ kind: "md", content: text.slice(lastIdx, m.index) });
    }
    parts.push({ kind: "think", content: m[1] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    parts.push({ kind: "md", content: text.slice(lastIdx) });
  }
  return parts;
}

interface ThinkBlockProps {
  text: string;
  className?: string;
}

function ThinkBlock({ text, className }: ThinkBlockProps) {
  // 视觉跟 ReasoningBlock 完全一致：浅灰背景、小字号、my-2 间距、leading-relaxed。
  // 原因见 ReasoningBlock.tsx 的 doc：think 和 reasoning_content 是同一类信息。
  return (
    <div
      className={cn(
        "my-2 whitespace-pre-wrap rounded bg-muted/40 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground",
        className
      )}
    >
      <Markdown>{text}</Markdown>
    </div>
  );
}

/**
 * Markdown — 把 markdown 字符串渲染成 HTML。
 *
 * 性能合约（性能优化 round 1）：
 * - 用 `React.memo` 包装：props 完全 shallow-equal 时**跳过整次 render**。
 * - props 故意保持简单（children / className / streaming 都是 primitive
 *   类型），React.memo 的默认浅比较足够。
 *
 * 进一步优化：流式场景下应使用 `<MarkdownStream>`，并且当前 pre-split
 * 切 think 块对 streaming 中间态也安全：未闭合的 think 会被 regex 跳过，
 * 剩余的 md 段单独走 react-markdown，layout 上不会出 `<p><div>`。
 */
export const Markdown = memo(function Markdown({
  children,
  className,
  streaming,
}: Props) {
  const proseClassName = cn(
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
    "prose-blockquote:my-2 prose-blockquote:text-foreground/85",
    "prose-table:text-sm",
    "prose-thead:border-b prose-thead:border-border",
    "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
    streaming && "streaming-cursor",
    className
  );

  const parts = splitAroundThink(children ?? "");

  // 没有 think 块：纯走原路径，保持单次 react-markdown 渲染（性能最优）。
  if (parts.length === 1 && parts[0]!.kind === "md") {
    return (
      <div className={proseClassName}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          rehypePlugins={[rehypeRaw, [rehypeHighlight, { detect: true }]]}
          components={markdownComponents}
        >
          {parts[0]!.content}
        </ReactMarkdown>
      </div>
    );
  }

  // 有 think 块：交错渲染 md 段 + think block。
  // 每个 md 段嵌套在自己 prose 容器里（避免 prose className 重叠导致的样式继承 bug）。
  return (
    <Fragment>
      {parts.map((p, i) =>
        p.kind === "md" ? (
          <div key={i} className={proseClassName}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              rehypePlugins={[rehypeRaw, [rehypeHighlight, { detect: true }]]}
              components={markdownComponents}
            >
              {p.content}
            </ReactMarkdown>
          </div>
        ) : (
          <ThinkBlock key={i} text={p.content} />
        )
      )}
    </Fragment>
  );
});