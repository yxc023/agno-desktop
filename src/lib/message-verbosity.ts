/**
 * message-verbosity — message.parts[] 的 partition 算法
 *
 * 把 ChatMessage.parts 切成 RenderItem 序列，给 MessageContent.tsx 渲染：
 *   - { kind: "single", part }   → PartRenderer 直接渲染
 *   - { kind: "group", tools }   → ToolCallGroup 折叠渲染
 *
 * 两个 mode：
 *   - brief=false（默认）：保留旧行为 —— 只对 read-like 工具做相邻合并（≥ 2 个）
 *   - brief=true：任何相邻 tool_call 都合并；≥ 2 个才出 group，单个仍走 single
 *
 * hideReasoning / 其他 part 过滤**不**在此处做：
 * 这层只是顺序与"是否折叠"决策；调用方负责在 partition 之前先
 * `.filter(p => p.type !== "reasoning")` 或类似过滤。这样算法本身
 * 保持纯函数、易测试。
 *
 * 故意不展开 PartRenderer / 渲染逻辑 —— MessageContent 里已经接好。
 */

import type { MessagePart, ToolCallPart } from "@/lib/message-types";
import { isReadLikeTool } from "@/lib/tool-render-utils";

export type RenderItem =
  | { kind: "single"; part: MessagePart }
  | { kind: "group"; tools: ToolCallPart[] };

export function partitionParts(
  parts: MessagePart[],
  brief: boolean
): RenderItem[] {
  const out: RenderItem[] = [];
  let toolBuf: ToolCallPart[] = [];

  const flush = () => {
    if (toolBuf.length === 0) return;
    if (toolBuf.length === 1) {
      out.push({ kind: "single", part: toolBuf[0] });
    } else {
      out.push({ kind: "group", tools: toolBuf });
    }
    toolBuf = [];
  };

  for (const part of parts) {
    if (part.type !== "tool_call") {
      flush();
      out.push({ kind: "single", part });
      continue;
    }

    // tool_call 分支：brief=true 一律入 buf；brief=false 只 read-like 入 buf，
    // 非 read-like 当作"会刷新 buf 的障碍"——和旧 groupConsecutiveReadCalls
    // 行为保持一致（单 web_search 仍走 single，避免被孤立 read-like 拉成 group）。
    if (brief || isReadLikeTool(part.toolName)) {
      toolBuf.push(part);
    } else {
      flush();
      out.push({ kind: "single", part });
    }
  }
  flush();
  return out;
}