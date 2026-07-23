/**
 * chat-buffer.ts — chat-store 的写入层 coalesce + shadow map。
 *
 * ## 问题 1：高频 SSE event 写 store → 高频 React render
 *
 * AGNO streaming 时一个 reply 可能产生 ~50 token/s 的 SSE event；
 * 每条 event 通过 `onMessageUpdate` 走 `updateAnyMessage → set(...)`
 * → Zustand 通知 → ChatPanel 重 render。50 次/秒的 React render 会和
 * markdown 重 parse 叠加造成肉眼可见的卡顿。
 *
 * 借鉴 OpenCode `coalesceServerEvents` 的核心思路：把同 (sessionId, messageId)
 * 的多次 update 在一个 microtask / animation frame 里合并，只把"最新"的
 * 那条消息写进 store。
 *
 * ## 问题 2：HTTP refetch 覆盖 live SSE 状态
 *
 * `loadHistory` 拉到的 snapshot 可能比当前 SSE 流的状态旧（AGNO 持久化的
 * `runs[].events[]` 不一定包含最新一次 run 的全部 in-flight event）。
 * 直接 `setMessages` 会用旧 snapshot 覆盖 streaming 中的消息。
 *
 * 借鉴 OpenCode `part_text_accum_delta` shadow map：
 *   - 在每次 flush 时，把每条消息里 text part 的累积文本按 part 在数组里
 *     的位置记到 shadow（TextPart 没 id，按位置索引即可）
 *   - `setMessages` 写入时，对每条 incoming message，如果 shadow 里有该
 *     位置的数据且 shadow 是 incoming 的前缀（说明 SSE 已经走得更远），
 *     就用 shadow 替换
 *
 * 模块级单例。无 React 依赖，方便测试。
 */

import type { ChatMessage } from "./message-types";

/** 每条 message 只保留最新一条；flush 时一次性 set。 */
interface PendingEntry {
  sessionId: string;
  message: ChatMessage;
}

const pendingByMessage = new Map<string, PendingEntry>();
function keyOf(sessionId: string, messageId: string): string {
  return `${sessionId}:${messageId}`;
}

let flushScheduled = false;
/** scheduled flush callback — 在 setBufferFlushCallback() 时注入，便于测试同步驱动。 */
let flushCallback: () => void = () => {};

/** 注入 flush 触发器。生产环境由 chat-store 调用。 */
export function setBufferFlushCallback(cb: () => void): void {
  flushCallback = cb;
}

/** 模块级：取当前 pending 队列（仅 flush 时使用）。 */
export function takePending(): PendingEntry[] {
  flushScheduled = false;
  if (pendingByMessage.size === 0) return [];
  const entries = Array.from(pendingByMessage.values());
  pendingByMessage.clear();
  return entries;
}

/**
 * 把更新加入 pending。同一 messageId 的多次 update 合并（取最新）。
 * 第一次入队时调度 flush（默认 microtask）。
 */
export function enqueueMessageUpdate(
  sessionId: string,
  message: ChatMessage
): void {
  pendingByMessage.set(keyOf(sessionId, message.id), { sessionId, message });
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  if (typeof queueMicrotask === "function") {
    queueMicrotask(flushCallback);
  } else {
    Promise.resolve().then(flushCallback);
  }
}

// ────────────────────────────────────────────────────────────────
// Shadow map：每个 message 各 text part 位置的最新文本。
// ────────────────────────────────────────────────────────────────

/** messageId → Map<partIndex, text>。TextPart 没有 id，按位置索引。 */
const shadowTextByMessage = new Map<string, Map<number, string>>();

/** 把 message 里所有 text part 的文本按位置写入 shadow。flush 时由 chat-store 调用。 */
export function captureShadowFromMessage(message: ChatMessage): void {
  const map = new Map<number, string>();
  message.parts.forEach((p, i) => {
    if (p.type === "text") map.set(i, p.text);
  });
  shadowTextByMessage.set(message.id, map);
}

/** 取某 message 的 shadow text（按 partIndex）。 */
export function getShadowText(
  messageId: string,
  partIndex: number
): string | undefined {
  return shadowTextByMessage.get(messageId)?.get(partIndex);
}

/**
 * 在 setMessages 合并时调用：把 incoming message 的 text part 替换为
 * shadow（如果 shadow 存在且是 incoming 的前缀）。
 *
 * 判定逻辑：
 *   - shadow 不存在 → 原样用 incoming
 *   - shadow 是 incoming 的前缀 → SSE 已经走得更远，用 shadow 替换
 *   - shadow 不在 incoming 的前缀 → 异常情况（shadow 丢了），原样用 incoming
 *
 * 返回：mutated message（新对象，原 message 不变）。
 */
export function mergeShadowIntoMessage(message: ChatMessage): ChatMessage {
  const map = shadowTextByMessage.get(message.id);
  if (!map || map.size === 0) return message;
  const newParts = message.parts.map((p, i) => {
    if (p.type !== "text") return p;
    const shadow = map.get(i);
    if (shadow === undefined) return p;
    if (shadow.startsWith(p.text)) {
      return { ...p, text: shadow };
    }
    return p;
  });
  // 优化：如果没有任何 part 被改，返回原对象
  const changed = newParts.some(
    (np, i) => np !== message.parts[i]
  );
  if (!changed) return message;
  return { ...message, parts: newParts };
}

/**
 * 清除某 message 的 shadow（completed / cancelled 后不再需要；避免无限
 * 累积）。chat-store 应在 onRunCompleted / onRunError 时调用。
 */
export function clearShadowForMessage(messageId: string): void {
  shadowTextByMessage.delete(messageId);
}

/** 清空所有 shadow（用于测试 reset 或整个 store 重置）。 */
export function clearAllShadows(): void {
  shadowTextByMessage.clear();
}

/** 仅测试用：检查某 messageId 是否有 shadow。 */
export function hasShadowFor(messageId: string): boolean {
  return shadowTextByMessage.has(messageId);
}

/** 仅测试用：直接查 shadow。 */
export function _shadowForTesting(
  messageId: string
): Map<number, string> | undefined {
  return shadowTextByMessage.get(messageId);
}

// ────────────────────────────────────────────────────────────────
// 测试辅助
// ────────────────────────────────────────────────────────────────

/** 测试用：重置模块状态。 */
export function _resetBufferForTesting(): void {
  pendingByMessage.clear();
  flushScheduled = false;
  shadowTextByMessage.clear();
}