/**
 * ContextProgressBar — 上下文用量进度（v3 紧凑圆环版）
 *
 * 数据口径（v2，per-call）：
 *   - "当前 context 长度" = AGNO ModelRequestCompleted 事件的
 *     input_tokens（最近一次 LLM 调用的精确 token 数）
 *     → 这才是"最近一次 LLM 实际送入的 prompt 大小"，也就是
 *     "下次再发消息时的 context size"
 *   - model id = 同一次事件的 `model` 字段（真实 LLM 名，不是 agent.endpoint
 *     给的 wrapper 如 "OpenAiChat"）；没拿到时回退到 agent.model.name。
 *   - 上限 = 前端映射表查 model id 得到（见 ../lib/model-context-windows.ts）
 *
 * 注意：v1 误用了 message.metrics.input_tokens（AGNO run 级累加值），
 * v2 改用 per-call 值，参见 chat-store.ts 的 latestInputTokensBySession。
 *
 * v3 视觉：从横长条+文字 → 小圆环。header 空间有限，完整信息移到 hover tooltip。
 *
 * 显示规则：
 *   - 始终显示一个 18px 圆环。底色是 muted/40 的浅轨；上层 arc 按
 *     当前百分比填充，按语义色。
 *   - 没拿到 per-call input_tokens → arc 长度 0，色是 muted 灰，
 *     hover tooltip 显示 "waiting for first response"
 *   - 有数据 → arc 长度 = pct，色按以下阈值（绿→琥珀→橙→红 渐变）：
 *     < 50% success（healthy）/ 50-80% accent（moderate）/
 *     80-95% warning（high）/ ≥ 95% destructive（critical）
 *   - hover（Radix Tooltip）显示完整：百分比 · 语义 / used / window / model
 *
 * 不做的事：
 *   - 不算 input box 里未发送的内容（用户明确说"最近一次 input_tokens 就行"）
 */

import { cn } from "@/lib/utils";
import {
  DEFAULT_CONTEXT_WINDOW,
  formatTokenCount,
  getContextWindow,
} from "@/lib/model-context-windows";
import type { AgAgentResponse } from "@/lib/agno-types";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface ContextProgressBarProps {
  /** 当前上下文 token 数（最近一次 LLM 调用的 input_tokens）；null 表示"还没有"。 */
  currentTokens: number | null;
  /** 当前 session 选中的 agent（用于查 model id） */
  agent?: AgAgentResponse | null;
  /**
   * 真实 model id（来自 SSE ModelRequestCompleted 事件的 `model` 字段）。
   * 优先于 `agent.model.name`（后者常是 wrapper 如 "OpenAiChat"）。
   * 常见用法：传 `useLatestModelId(sessionId)`。
   */
  modelId?: string | null;
  className?: string;
}

/**
 * 把 AgModelResponse.model 规范成 model id 字符串。
 * AgModelResponse.model 在 schema 里是 string | AgModelResponse | null，
 * 这里两种形态都兼容。
 */
function resolveModelId(
  agent: AgAgentResponse | null | undefined
): string | null {
  if (!agent) return null;
  const m = agent.model;
  if (!m) return null;
  if (typeof m === "string") return m;
  if (typeof m === "object" && typeof m.name === "string") return m.name;
  if (typeof m === "object" && typeof m.model === "string") return m.model;
  return null;
}

/**
 * 把"百分比"映射到"语义颜色"：
 *   - < 50%  : success（绿）   → 还有很多余量，**健康**
 *   - 50-80% : accent（琥珀）  → 用了一半多，**正常**（品牌色，避免和"健康"色混淆）
 *   - 80-95% : warning（橙）   → 接近上限，**高占用**
 *   - ≥ 95%  : destructive（红）→ 即将撞上下文窗口，**危险**
 *
 * 色相从冷到暖连续（绿 → 琥珀 → 橙 → 红），符合"占用越多越危险"的直觉。
 */
function pctColor(pct: number): {
  stroke: string;
  text: string;
  label: string;
} {
  if (pct >= 95)
    return {
      stroke: "text-destructive",
      text: "text-destructive",
      label: "critical",
    };
  if (pct >= 80)
    return {
      stroke: "text-warning",
      text: "text-warning",
      label: "high",
    };
  if (pct >= 50)
    return {
      stroke: "text-accent",
      text: "text-accent",
      label: "moderate",
    };
  return {
    stroke: "text-success",
    text: "text-success",
    label: "healthy",
  };
}

// 圆环几何参数 —— 固定常量，整文件只此一处。
// 18px 圆环 + 2px stroke，留 1px 给 stroke-linecap 圆头"溢出"避免被裁。
const RING_SIZE = 18;
const RING_STROKE = 2;
const RING_R = (RING_SIZE - RING_STROKE) / 2; // 8
const RING_C = 2 * Math.PI * RING_R; // 圆周长

function CompactRing({
  pct,
  strokeClass,
}: {
  pct: number;
  /** SVG stroke 用 currentColor，所以传 text-* className 即可 */
  strokeClass: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * RING_C;
  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      // rotate -90 把起点从 3 点钟方向挪到 12 点钟方向，arc 顺时针增长
      className="shrink-0 rotate-[-90deg]"
      aria-hidden="true"
    >
      {/* 背景轨 */}
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_R}
        fill="none"
        stroke="currentColor"
        strokeWidth={RING_STROKE}
        className="text-muted-foreground/30"
      />
      {/* 进度弧 */}
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_R}
        fill="none"
        stroke="currentColor"
        strokeWidth={RING_STROKE}
        strokeDasharray={`${dash} ${RING_C}`}
        strokeLinecap="round"
        className={cn("transition-[stroke-dasharray] duration-300", strokeClass)}
      />
    </svg>
  );
}

export function ContextProgressBar({
  currentTokens,
  agent,
  modelId: modelIdOverride,
  className,
}: ContextProgressBarProps) {
  // 优先用 SSE 真实 model id（wrapper agent 名如 "OpenAiChat" 查不到任何条目）。
  const modelId = modelIdOverride || resolveModelId(agent);
  const contextWindow = getContextWindow(modelId);
  const fallbackToDefault = modelId
    ? contextWindow === DEFAULT_CONTEXT_WINDOW
    : true;

  // 还没拿到 per-call input_tokens 时的占位
  if (currentTokens == null) {
    return (
      <Tooltip delayDuration={150}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="context usage (waiting for first response)"
            className={cn(
              "flex items-center justify-center rounded-full p-0.5 text-muted-foreground/50",
              "hover:bg-muted/50 hover:text-foreground/70",
              "transition-colors",
              className
            )}
          >
            <CompactRing
              pct={0}
              strokeClass="text-muted-foreground/40"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-0.5 font-mono text-[10.5px]">
            <div className="font-semibold text-primary-foreground">
              Context usage
            </div>
            <div className="text-primary-foreground/70">
              waiting for first response
            </div>
            <div className="text-primary-foreground/60 tabular-nums">
              window: {formatTokenCount(contextWindow)}
              {fallbackToDefault ? " (default)" : ""}
            </div>
            {modelId && (
              <div className="text-primary-foreground/60">
                model: {modelId}
              </div>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  const pct = (currentTokens / Math.max(1, contextWindow)) * 100;
  const color = pctColor(pct);

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`context usage ${pct.toFixed(0)}%`}
          className={cn(
            "flex items-center justify-center rounded-full p-0.5",
            "hover:bg-muted/50",
            "transition-colors",
            className
          )}
        >
          <CompactRing pct={pct} strokeClass={color.stroke} />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5 font-mono text-[10.5px]">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-primary-foreground">
              Context usage
            </span>
            <span className={cn("tabular-nums", color.text)}>
              {pct.toFixed(1)}% · {color.label}
            </span>
          </div>
          <div className="text-primary-foreground/80 tabular-nums">
            {currentTokens.toLocaleString()} /{" "}
            {contextWindow.toLocaleString()} tokens
          </div>
          {fallbackToDefault && (
            <div className="text-primary-foreground/50">
              window: default (no model mapping)
            </div>
          )}
          {modelId && (
            <div className="text-primary-foreground/60">model: {modelId}</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
