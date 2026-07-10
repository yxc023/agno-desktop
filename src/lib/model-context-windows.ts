/**
 * Model context window 映射表 + 查询函数
 *
 * 用途：context 进度条要计算"当前已用 / 上限"的百分比，但 AGNO server 的
 * AgModelResponse 当前只暴露 { name, provider }，没有 context_window 字段
 * （见 src/lib/agno-types.ts）。
 *
 * 临时方案：前端硬编码一张常见模型映射表 + 一个兜底值。后续如要更准，可：
 *   1. 给 AgModelResponse 加 context_window 字段（需 AGNO server 配合）
 *   2. 调 OpenRouter / LiteLLM 的模型注册 API（增加外部依赖）
 *
 * 匹配策略：
 *   - 优先精确匹配（lowercased）
 *   - 否则按最长前缀匹配（"gpt-4o-2024-08-06" → "gpt-4o"）
 *   - 否则用 DEFAULT_CONTEXT_WINDOW
 *
 * 数据维护约定：日期 + 来源写注释，方便后续核对。
 */

export interface ModelContextEntry {
  /** 上下文窗口 token 数 */
  contextWindow: number;
  /** 可选备注：发布日期 / 来源 / 注意事项 */
  note?: string;
}

/**
 * 常见模型 context window 映射
 *
 * 数字取自各厂商官方文档 / 系统卡（2025-06 截止）：
 * - OpenAI:   https://platform.openai.com/docs/models
 * - Anthropic: https://docs.anthropic.com/en/docs/about-claude/models
 * - Google:   https://ai.google.dev/gemini-api/docs/models
 * - Meta:     https://github.com/meta-llama/llama-models
 * - Mistral:  https://docs.mistral.ai/getting-started/models/models_overview
 * - Qwen:     https://help.aliyun.com/zh/model-studio/models
 * - DeepSeek: https://api-docs.deepseek.com/quick_start/pricing
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, ModelContextEntry> = {
  // ---------- OpenAI ----------
  "gpt-4o": { contextWindow: 128_000, note: "OpenAI gpt-4o (128k)" },
  "gpt-4o-mini": { contextWindow: 128_000, note: "OpenAI gpt-4o-mini (128k)" },
  "gpt-4-turbo": { contextWindow: 128_000, note: "OpenAI gpt-4-turbo (128k)" },
  "gpt-4-turbo-preview": { contextWindow: 128_000, note: "OpenAI gpt-4-turbo-preview" },
  "gpt-4": { contextWindow: 8_192, note: "OpenAI gpt-4 legacy 8k" },
  "gpt-3.5-turbo": { contextWindow: 16_385, note: "OpenAI gpt-3.5-turbo 16k" },
  "gpt-3.5": { contextWindow: 4_096, note: "OpenAI gpt-3.5 4k" },
  "o1": { contextWindow: 200_000, note: "OpenAI o1 (200k)" },
  "o1-pro": { contextWindow: 200_000, note: "OpenAI o1-pro" },
  "o1-mini": { contextWindow: 128_000, note: "OpenAI o1-mini" },
  "o1-preview": { contextWindow: 128_000, note: "OpenAI o1-preview" },
  "o3": { contextWindow: 200_000, note: "OpenAI o3" },
  "o3-mini": { contextWindow: 200_000, note: "OpenAI o3-mini" },
  "o4-mini": { contextWindow: 200_000, note: "OpenAI o4-mini" },
  "gpt-5": { contextWindow: 400_000, note: "OpenAI gpt-5 (400k, 2025-08)" },
  "gpt-5-mini": { contextWindow: 400_000, note: "OpenAI gpt-5-mini" },
  "gpt-5-nano": { contextWindow: 400_000, note: "OpenAI gpt-5-nano" },
  "gpt-4.1": { contextWindow: 1_000_000, note: "OpenAI gpt-4.1 (1M)" },
  "gpt-4.1-mini": { contextWindow: 1_000_000, note: "OpenAI gpt-4.1-mini" },
  "gpt-4.1-nano": { contextWindow: 1_000_000, note: "OpenAI gpt-4.1-nano" },

  // ---------- Anthropic ----------
  "claude-3-5-sonnet": { contextWindow: 200_000, note: "Anthropic claude-3-5-sonnet" },
  "claude-3-5-sonnet-latest": { contextWindow: 200_000 },
  "claude-3-5-haiku": { contextWindow: 200_000, note: "Anthropic claude-3-5-haiku" },
  "claude-3-5-haiku-latest": { contextWindow: 200_000 },
  "claude-3-opus": { contextWindow: 200_000, note: "Anthropic claude-3-opus" },
  "claude-3-opus-latest": { contextWindow: 200_000 },
  "claude-3-sonnet": { contextWindow: 200_000, note: "Anthropic claude-3-sonnet" },
  "claude-3-haiku": { contextWindow: 200_000, note: "Anthropic claude-3-haiku" },
  "claude-2": { contextWindow: 100_000, note: "Anthropic claude-2 100k" },
  "claude-2.1": { contextWindow: 200_000, note: "Anthropic claude-2.1 200k" },
  "claude-sonnet-4": { contextWindow: 200_000, note: "Anthropic claude-sonnet-4" },
  "claude-opus-4": { contextWindow: 200_000, note: "Anthropic claude-opus-4" },
  "claude-haiku-4": { contextWindow: 200_000, note: "Anthropic claude-haiku-4" },

  // ---------- Google ----------
  "gemini-1.5-pro": { contextWindow: 2_097_152, note: "Google gemini-1.5-pro 2M" },
  "gemini-1.5-flash": { contextWindow: 1_048_576, note: "Google gemini-1.5-flash 1M" },
  "gemini-1.5-flash-8b": { contextWindow: 1_048_576, note: "Google gemini-1.5-flash-8b" },
  "gemini-2.0-flash": { contextWindow: 1_048_576, note: "Google gemini-2.0-flash 1M" },
  "gemini-2.0-flash-exp": { contextWindow: 1_048_576 },
  "gemini-2.0-flash-thinking-exp": { contextWindow: 1_048_576 },
  "gemini-2.5-pro": { contextWindow: 1_048_576, note: "Google gemini-2.5-pro 1M" },
  "gemini-2.5-flash": { contextWindow: 1_048_576, note: "Google gemini-2.5-flash 1M" },
  "gemini-2.5-flash-lite": { contextWindow: 1_048_576 },
  "gemini-3-pro": { contextWindow: 1_048_576, note: "Google gemini-3-pro 1M" },

  // ---------- Meta (Ollama / Together) ----------
  "llama3.1": { contextWindow: 128_000, note: "Meta llama-3.1 128k" },
  "llama3.2": { contextWindow: 128_000, note: "Meta llama-3.2 128k" },
  "llama-3.1-70b": { contextWindow: 128_000 },
  "llama-3.1-8b": { contextWindow: 128_000 },
  "llama-3.1-405b": { contextWindow: 128_000 },
  "llama-3.3-70b": { contextWindow: 128_000, note: "Meta llama-3.3-70b 128k" },
  "llama-3.2-1b": { contextWindow: 128_000 },
  "llama-3.2-3b": { contextWindow: 128_000 },
  "llama-3.2-11b-vision": { contextWindow: 128_000 },
  "llama-3.2-90b-vision": { contextWindow: 128_000 },

  // ---------- Mistral ----------
  "mistral-large": { contextWindow: 128_000, note: "Mistral Large 128k" },
  "mistral-large-2": { contextWindow: 128_000 },
  "mistral-medium": { contextWindow: 128_000, note: "Mistral Medium (deprecated)" },
  "mistral-small": { contextWindow: 32_000, note: "Mistral Small 32k" },
  "mistral-nemo": { contextWindow: 128_000, note: "Mistral Nemo 128k" },
  "mixtral-8x7b": { contextWindow: 32_000, note: "Mixtral 8x7B 32k" },
  "mixtral-8x22b": { contextWindow: 64_000, note: "Mixtral 8x22B 64k" },
  "codestral": { contextWindow: 32_000, note: "Mistral Codestral 32k" },

  // ---------- Qwen (通义千问) ----------
  "qwen-max": { contextWindow: 32_768, note: "Qwen Max 32k" },
  "qwen-plus": { contextWindow: 131_072, note: "Qwen Plus 128k" },
  "qwen-turbo": { contextWindow: 1_000_000, note: "Qwen Turbo 1M" },
  "qwen-long": { contextWindow: 10_000_000, note: "Qwen Long 10M" },
  "qwen2.5-72b": { contextWindow: 131_072, note: "Qwen 2.5 72B 128k" },
  "qwen2.5-32b": { contextWindow: 131_072 },
  "qwen2.5-14b": { contextWindow: 131_072 },
  "qwen2.5-7b": { contextWindow: 131_072 },
  "qwen2.5-3b": { contextWindow: 131_072 },
  "qwen2.5-1.5b": { contextWindow: 131_072 },
  "qwen2.5-0.5b": { contextWindow: 131_072 },
  "qwen3-235b": { contextWindow: 131_072, note: "Qwen3 235B 128k" },
  "qwen3-32b": { contextWindow: 131_072 },
  "qwen3-8b": { contextWindow: 131_072 },
  "qwen3-4b": { contextWindow: 131_072 },
  "qwen3-1.7b": { contextWindow: 131_072 },
  "qwen3-0.6b": { contextWindow: 131_072 },

  // ---------- DeepSeek ----------
  "deepseek-chat": { contextWindow: 64_000, note: "DeepSeek-V3 64k" },
  "deepseek-reasoner": { contextWindow: 64_000, note: "DeepSeek-R1 64k" },
  "deepseek-coder": { contextWindow: 64_000, note: "DeepSeek Coder 64k" },
  "deepseek-v3": { contextWindow: 64_000 },
  "deepseek-r1": { contextWindow: 64_000 },

  // ---------- 其他常见 ----------
  "command-r-plus": { contextWindow: 200_000, note: "Cohere Command R+ 200k" },
  "command-r": { contextWindow: 128_000, note: "Cohere Command R 128k" },
  "phi-3": { contextWindow: 128_000, note: "Microsoft Phi-3 128k" },
  "phi-3.5": { contextWindow: 128_000 },
  "grok-2": { contextWindow: 131_072, note: "xAI Grok 2 128k" },
  "grok-3": { contextWindow: 131_072, note: "xAI Grok 3 128k" },
  "grok-4": { contextWindow: 256_000, note: "xAI Grok 4 256k" },
  "yi-1.5-34b": { contextWindow: 200_000, note: "零一万物 Yi 1.5 200k" },
  "yi-1.5-9b": { contextWindow: 200_000 },
  "glm-4": { contextWindow: 128_000, note: "智谱 GLM-4 128k" },
  "glm-4-plus": { contextWindow: 128_000 },
  "glm-4-long": { contextWindow: 1_000_000, note: "GLM-4-Long 1M" },
  "abab6.5s": { contextWindow: 245_760, note: "MiniMax abab6.5s 240k" },
  "abab6.5g": { contextWindow: 245_760 },
  "abab6.5t": { contextWindow: 245_760 },
  "abab7-chat": { contextWindow: 245_760 },
  "MiniMax-M2.7": { contextWindow: 192_000, note: "MiniMax M2 系列 192k（按用户实例观察，TODO: 确认准确值）" },
  "MiniMax-M2": { contextWindow: 192_000, note: "MiniMax M2 系列 192k" },
  "MiniMax-abab": { contextWindow: 245_760, note: "MiniMax abab 系列兜底" },
};

/** 找不到时的兜底值。128k 是当下主流模型的"中位数"，配合 UI 提示用户去设置。 */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * 从 model id 查 context window。
 *
 * 匹配规则（按顺序）：
 * 1. 大小写不敏感的精确匹配
 * 2. 否则在所有 key 里找"最长前缀匹配"（"gpt-4o-2024-08-06" 命中 "gpt-4o"）
 * 3. 都没有 → DEFAULT_CONTEXT_WINDOW
 *
 * 为什么用最长前缀：模型 id 经常带日期 / 后缀（"gpt-4o-2024-08-06"、
 * "claude-3-5-sonnet-20241022"），但短前缀容易误伤（比如 "o3" 可能误命中 "o3-mini"
 * 之前的 "o1/o1-mini/o1-preview" 等等）。用最长前缀能减少这种碰撞。
 */
export function getContextWindow(modelId: string | null | undefined): number {
  if (!modelId) return DEFAULT_CONTEXT_WINDOW;
  const id = String(modelId).trim().toLowerCase();
  if (!id) return DEFAULT_CONTEXT_WINDOW;

  // 1) 精确匹配
  const exact = MODEL_CONTEXT_WINDOWS[id];
  if (exact) return exact.contextWindow;

  // 2) 最长前缀匹配
  let bestKey: string | null = null;
  let bestLen = -1;
  for (const key of Object.keys(MODEL_CONTEXT_WINDOWS)) {
    if (id === key) continue; // 已在上一步处理
    if (id.startsWith(key + "-") || id.startsWith(key + ".") || id.startsWith(key + ":")) {
      if (key.length > bestLen) {
        bestLen = key.length;
        bestKey = key;
      }
    }
  }
  if (bestKey) {
    return MODEL_CONTEXT_WINDOWS[bestKey]!.contextWindow;
  }

  // 3) 兜底
  return DEFAULT_CONTEXT_WINDOW;
}

/** 把 token 数格式化成简短可读字符串：1234 → "1.2k"，2_000_000 → "2.0M" */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}
