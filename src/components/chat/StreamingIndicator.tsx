/**
 * StreamingIndicator — 替代原来 ChatPanel header 里的静态 "streaming" 徽章
 *
 * Claude-Code-style 风格：流式期间显示三色脉冲点 + 实时 token 计数 +
 * 已用时长，给用户"在生成"+"输出正在增长"+"已经用时多久"的三重视觉反馈。
 *
 * 数据来源：
 *   - ↑ N  (input tokens)  → useLatestInputTokens(lastCompletedRoundExact)
 *   - ↓ ~M (output tokens) → estimateTokensText(累积的 TextPart.text)
 *   - · T  (elapsed time)   → 自组件 mount 起累计(setInterval 100ms)
 *
 * 没有真正的 per-delta token 事件可以拿 —— AGNO 只在每次 LLM 调用完成后
 * 一次性发 input_tokens / output_tokens（per-call 精确值）。stream 期间
 * 只能从文本长度估算（带 ~ 前缀）。
 *
 * 等价于：
 *   - round 1 流式：~50 → ~100 → ~150 → ModelRequestCompleted → exact 145
 *   - round 2 流式：~145 + ~5 → ~145 + ~50 → ... → exact 145 + 210
 *
 * 但我们不刻意把 exact baseline 叠加进 live estimate —— 因为下一轮开始的
 * 准确时机难以追踪（chat-runner 内部状态），且叠加会让数字跳变。简化：
 *   - 显示 live estimate（数字带 ~，明确告诉用户"估计中"）
 *   - exact 值在 run 结束后由 message footer 显示（message.metrics.total_tokens）
 *
 * 仅在 isRunning 时渲染。完成后返回 null —— 整段徽章从 header 消失，
 * 简洁地把视觉焦点让回对话内容。
 */

import { useEffect, useMemo, useState } from "react";
import { useChatStore } from "@/stores/chat-store";
import {
  useLatestInputTokens,
  useLatestOutputTokens,
} from "@/stores/chat-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useCurrentSessionMessages } from "@/stores/chat-store";
import { estimateTokens } from "@/lib/estimate-tokens";

export function StreamingIndicator() {
  const isRunning = useChatStore((s) => s.runner?.isRunning() ?? false);
  const currentSessionId = useSessionsStore((s) => s.currentSessionId);
  const messages = useCurrentSessionMessages(currentSessionId);
  const inputTokens = useLatestInputTokens(currentSessionId);
  const outputTokensExact = useLatestOutputTokens(currentSessionId);

  // 当前正在 streaming 的顶层 message 的文本（live ticker 数据源）
  const streamingText = useMemo(() => {
    if (!isRunning) return "";
    let text = "";
    for (const m of messages) {
      if (m.status !== "streaming") continue;
      for (const p of m.parts) {
        if (p.type === "text") text += p.text;
      }
    }
    return text;
  }, [isRunning, messages]);

  const liveOutput = estimateTokens(streamingText);

  // Elapsed since isRunning became true
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!isRunning) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    setElapsed(0);
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 100);
    return () => clearInterval(interval);
  }, [isRunning]);

  if (!isRunning) return null;

  return (
    <div
      className="flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-0.5 font-mono text-[10px] text-accent/90 transition-opacity"
      role="status"
      aria-live="polite"
    >
      <span aria-hidden className="flex items-center gap-[3px]">
        <span className="h-1 w-1 rounded-full bg-accent animate-pulse-dot" />
        <span className="h-1 w-1 rounded-full bg-accent animate-pulse-dot [animation-delay:0.15s]" />
        <span className="h-1 w-1 rounded-full bg-accent animate-pulse-dot [animation-delay:0.3s]" />
      </span>
      {inputTokens != null && (
        <span className="tabular-nums" title="上一次 LLM 调用的 input tokens">
          ↑ {inputTokens.toLocaleString()}
        </span>
      )}
      <span
        className="tabular-nums"
        title="基于累积 text 长度的实时估算；最终精确值在 message footer"
      >
        ↓ ~{liveOutput.toLocaleString()}
      </span>
      {outputTokensExact != null && outputTokensExact > 0 && (
        <span
          className="text-accent/60 tabular-nums"
          title="上一次已完成 LLM 调用的精确 output"
        >
          · 累计 {outputTokensExact.toLocaleString()}
        </span>
      )}
      <span className="tabular-nums text-accent/70">{formatElapsed(elapsed)}</span>
    </div>
  );
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}m${sec.toString().padStart(2, "0")}s`;
}