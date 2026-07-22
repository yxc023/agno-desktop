import { Loader2 } from "lucide-react";
import { Markdown } from "@/components/markdown/Markdown";

interface ReasoningBlockProps {
  text: string;
  steps?: Array<{
    title?: string;
    reasoning?: string;
    action?: string;
    result?: string;
  }>;
  streaming?: boolean;
}

/**
 * ReasoningBlock — 渲染模型的"思考过程"。
 *
 * ## 设计意图
 * 与 Markdown 组件里的 `think` override（处理 `<think>...</think>` 标签）共用同
 * 一套视觉：浅灰背景、小字号、不折叠。两个数据源（AGNO 的 `reasoning_content`
 * event 和模型直接吐到 messages[].content 里的 `<think>` 标签）本质上是同一类
 * 信息——模型的 chain-of-thought——视觉上不应让用户觉得是两种东西。
 *
 * ## 不折叠
 * 之前版本有 collapse 交互（chevron + toggle），用户反馈跟 think 不一致，去掉。
 * 未来如果需要在 settings 里加"不显示思考"/"思考默认折叠"，整段返回 null 即可。
 *
 * ## streaming 视觉
 * streaming 时只显示一个 Loader2 spinner，文本等 markdown 自己渲染（避免半截文
 * 本在 box 里跳动）。
 */
export function ReasoningBlock({ text, steps, streaming }: ReasoningBlockProps) {
  const hasSteps = steps && steps.length > 0;

  return (
    <div className="my-2 whitespace-pre-wrap rounded bg-muted/40 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
      <div className="mb-1 flex items-center gap-2 font-medium">
        {streaming ? "思考中" : "思考过程"}
        {streaming && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>

      <div className="space-y-2.5">
        {hasSteps && (
          <div className="space-y-2">
            {steps.map((s, i) => (
              <div key={i} className="flex gap-2.5">
                <span className="shrink-0 pt-0.5 font-mono text-[10px] opacity-60">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  {s.title && <div className="font-medium text-foreground/85">{s.title}</div>}
                  {s.action && (
                    <div className="italic opacity-80">
                      <span>→</span> {s.action}
                    </div>
                  )}
                  {s.reasoning && (
                    <Markdown className="text-[11.5px] [&_p]:my-0.5">{s.reasoning}</Markdown>
                  )}
                  {s.result && (
                    <div className="border-l-2 border-muted-foreground/20 pl-2 text-[11px] opacity-80">
                      {s.result}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {text && (
          <Markdown className="text-[11.5px] [&_p]:my-1">{text}</Markdown>
        )}
      </div>
    </div>
  );
}