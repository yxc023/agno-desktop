/**
 * StreamingIndicator — 替代原来 ChatPanel header 里的静态 "streaming" 徽章
 *
 * Claude-Code-style 风格：流式期间显示三色脉冲点 + 实时 token 计数 +
 * 已用时长，给用户"在生成"+"输出正在增长"+"已经用时多久"的三重视觉反馈。
 *
 * 数据来源：
 *   - ↑ N  (input tokens)   → useLatestInputTokens(lastCompletedRoundExact)
 *   - ↓ ~M (output tokens)  → estimateTokensText(累积的 TextPart.text)
 *   - · 累计 K (output 精确) → useLatestOutputTokens(per-call exact, 上次已完成 round)
 *   - · T  (elapsed time)   → 自组件 mount 起累计(setInterval 100ms)
 *
 * 没有真正的 per-delta token 事件可以拿 —— AGNO 只在每次 LLM 调用完成后
 * 一次性发 input_tokens / output_tokens（per-call 精确值）。stream 期间
 * 只能从文本长度估算（带 ~ 前缀）。
 *
 * 简化策略（不混合精确基线 + 估算 delta）：
 *   - 当前 round 在 streaming 时显示 ↓ ~M（live estimate from text）
 *   - 上一次已完成 round 的精确 output 作为" ·累计 K" baseline 显示（可选用）
 *   - 整轮 turn 结束后由 message footer 显示 message.metrics.total_tokens
 *
 * 仅在 isRunning 时渲染。完成后返回 null —— 整段徽章从 header 消失，
 * 简洁地把视觉焦点让回对话内容。
 *
 * a11y: role=status + aria-live=polite 让屏幕阅读器也能拿到 tick。
 */

import { useEffect, useState } from "react";
import { useChatStore } from "@/stores/chat-store";
import {
  useLatestInputTokens,
  useLatestOutputTokens,
  useCurrentSessionMessages,
} from "@/stores/chat-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { estimateTokens } from "@/lib/estimate-tokens";

export function StreamingIndicator() {
  const isRunning = useChatStore((s) => s.runner?.isRunning() ?? false);
  const currentSessionId = useSessionsStore((s) => s.currentSessionId);
  const messages = useCurrentSessionMessages(currentSessionId);
  const inputTokens = useLatestInputTokens(currentSessionId);
  const outputTokensExact = useLatestOutputTokens(currentSessionId);

  // 直接计算,不 memoize —— 组件只在订阅变化时才 render,这里的 O(parts) 扫描
  // 完全够快;而且避免了 memoize deps (尤其是 messages 数组 ref) 漏掉的边界 case
  let streamingText = "";
  for (const m of messages) {
    if (m.status !== "streaming") continue;
    for (const p of m.parts) {
      if (p.type === "text") streamingText += p.text;
    }
  }
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
      data-debug-running={isRunning ? "1" : "0"}
      data-debug-session={currentSessionId ?? "null"}
      data-debug-msgs={messages.length}
      data-debug-streaming-bytes={streamingText.length}
      data-debug-live-output={liveOutput}
      data-debug-elapsed-ms={elapsed}
      data-debug-input={inputTokens ?? "null"}
      data-debug-output-exact={outputTokensExact ?? "null"}
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
      <span className="tabular-nums text-accent/70">
        {formatElapsed(elapsed)}
      </span>
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