/**
 * estimate-tokens — 从 text 长度粗估 token 数
 *
 * 用于 streaming 时的"动态计数"——AGNO SSE 没有 per-delta token 事件,
 * output_tokens 只能在 ModelRequestCompleted 时拿到(per-LLM-call 精确值,
 * 不在 delta 流里)。
 *
 * 模型 tokenizer 精确度靠 tiktoken / model-specific counter,这里不需要那么
 * 准 —— 目的是给用户一个"流式输出正在增长"的视觉反馈,~20% 误差可接受。
 *
 * 启发式:
 *   - CJK 字符(中文 / 日文 / 韩文):约 1.5 字符 = 1 token(BPE 通常 pair)
 *   - 其他字符(拉丁 / 数字 / 符号):约 4 字符 = 1 token(常见英文 ratio)
 *
 * 用 charCodeAt + 范围判断而不是 regex 是为了在 streaming 时跑得快 —— 每帧
 * TextPart 文本可能增长几千字符,O(n) 单遍扫描无 regex compile 开销。
 *
 * 输出永远 ≥ 0;空串 / 非字符串 → 0。
 */

export function estimateTokens(text: unknown): number {
  if (typeof text !== "string" || text.length === 0) return 0;

  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // 合并检查:CJK Unified / Extension A / Hiragana+Katakana / Hangul
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk / 1.5) + Math.ceil(other / 4);
}