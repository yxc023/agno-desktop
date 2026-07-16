/**
 * Model context window 映射表 + 查询函数
 *
 * 数据来源（按优先级）：
 *   1. 远程目录：https://models.dev/api.json（SST 维护的开放 LLM 目录）
 *      - 应用启动时 fetch 一次（带 24h localStorage 缓存）
 *      - fetch 失败但有 stale cache → 用 stale cache
 *      - 都没有 → 走第 2 步
 *   2. 内置 map（`MODEL_CONTEXT_WINDOWS`）：兜底，离线 / 启动失败时仍可用
 *   3. `DEFAULT_CONTEXT_WINDOW`：上面都查不到时的最终兜底
 *
 * 为什么同时保留内置表：
 *   - models.dev 首次 fetch 前（SSR / 离线 / Cloudflare 抽风）需要给一个答案
 *   - 内置表覆盖主流厂商，没网也能用
 *
 * 匹配策略（对每个数据源都执行）：
 *   - 大小写不敏感的精确匹配
 *   - 否则最长前缀匹配（"gpt-4o-2024-08-06" → "gpt-4o"）
 *
 * models.dev 结构（精简）：
 *   - 顶层 `Record<providerId, ProviderEntry>`，无 wrapper
 *   - ProviderEntry.models[id].limit.context = 上下文窗口（必填）
 *   - 顶层 key 含 `*-token-plan` / `*-coding-plan` / `*-cn` 等 plan / region 变体
 *     → 全部过滤掉，避免 key 重复
 *   - API 总大小约 3 MB，绝不 bundle 进 dist；fetch 一次 + localStorage 缓存
 *
 * 参考：https://models.dev / https://github.com/sst/models.dev
 */

const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_KEY = "agno:models-dev-catalog";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface ModelContextEntry {
  /** 上下文窗口 token 数 */
  contextWindow: number;
  /** 可选备注：发布日期 / 来源 / 注意事项 */
  note?: string;
}

/**
 * 远程 catalog 的简化结构（只取关心的字段）。
 * 完整 schema 很大且会演进，只 narrow 我们用得到的部分。
 */
interface ModelsDevModel {
  id: string;
  name: string;
  limit?: { context?: number; input?: number; output?: number };
  release_date?: string;
}

interface ModelsDevProvider {
  id: string;
  name: string;
  models: Record<string, ModelsDevModel>;
}

/** 过滤掉 plan / region 变体（不是模型主体，是商业套餐 / 区域 endpoint） */
function isCanonicalProvider(providerId: string): boolean {
  return (
    !providerId.endsWith("-token-plan") &&
    !providerId.endsWith("-coding-plan") &&
    !providerId.endsWith("-cn") &&
    !providerId.endsWith("-coding")
  );
}

/**
 * 常见模型 context window 映射（内置兜底表）
 *
 * 数字取自各厂商官方文档 / 系统卡（2026-06 截止）：
 * - OpenAI:    https://platform.openai.com/docs/models
 * - Anthropic: https://docs.anthropic.com/en/docs/about-claude/models
 * - Google:    https://ai.google.dev/gemini-api/docs/models
 * - Meta:      https://github.com/meta-llama/llama-models
 * - Mistral:   https://docs.mistral.ai/getting-started/models/models_overview
 * - Qwen:      https://help.aliyun.com/zh/model-studio/models
 * - DeepSeek:  https://api-docs.deepseek.com/quick_start/pricing
 * - Doubao:    https://www.volcengine.com/docs/82379
 *
 * 完整映射见 `public/config/model-context-windows.json`，本表只作离线兜底。
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
  "gpt-5-nano": { "contextWindow": 400_000, note: "OpenAI gpt-5-nano" },
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
  "qwen3.6-plus": { contextWindow: 1_000_000, note: "Qwen3.6-Plus (2026-04) 1M" },
  "qwen3.6-plus-preview": { contextWindow: 1_000_000, note: "Qwen3.6-Plus 预览版" },
  "qwen3.6-max": { contextWindow: 262_144, note: "Qwen3.6-Max 预览版 (2026-04) 262k（models.dev 值）" },

  // ---------- DeepSeek ----------
  "deepseek-chat": { contextWindow: 64_000, note: "DeepSeek-V3 64k" },
  "deepseek-reasoner": { contextWindow: 64_000, note: "DeepSeek-R1 64k" },
  "deepseek-coder": { contextWindow: 64_000, note: "DeepSeek Coder 64k" },
  "deepseek-v3": { contextWindow: 64_000 },
  "deepseek-r1": { contextWindow: 64_000 },

  // ---------- Doubao (字节跳动火山引擎) ----------
  // 大部分值来自新闻/评测，"TODO: 确认精确值" 标注的请按需核对官方文档。
  "doubao-1.5-pro": { contextWindow: 256_000, note: "Doubao 1.5 Pro 256k (2025-01)" },
  "doubao-1.5-pro-256k": { contextWindow: 256_000 },
  "doubao-1.5-pro-32k": { contextWindow: 32_000, note: "Doubao 1.5 Pro 32k 变体" },
  "doubao-1.5-lite": { contextWindow: 256_000, note: "Doubao 1.5 Lite 256k (TODO: 确认精确值)" },
  "doubao-1.5-vision-pro": { contextWindow: 128_000, note: "Doubao 1.5 Vision Pro 128k (TODO: 确认精确值)" },
  "doubao-1.8": { contextWindow: 256_000, note: "Doubao 1.8 (2025-12) 256k (TODO: 确认精确值)" },
  "doubao-2.1": { contextWindow: 256_000, note: "Doubao 2.1 (2026-06) 256k (TODO: 确认精确值)" },
  "doubao-2.1-pro": { contextWindow: 256_000 },
  "doubao-seed-code": { contextWindow: 128_000, note: "Doubao-Seed-Code (2025-11) 编程模型 (TODO: 确认精确值)" },
  "doubao-seed-2.0-lite": { contextWindow: 128_000, note: "Doubao-Seed-2.0-lite (2026-05) 全模态 128k (TODO: 确认精确值)" },

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
  "MiniMax-M3": { contextWindow: 512_000, note: "MiniMax M3 (2026-06) 512k（models.dev 值，1M 是峰值，512k 是保证可用）" },
  "MiniMax-M3-preview": { contextWindow: 512_000, note: "MiniMax M3 预览版" },
  "MiniMax-abab": { contextWindow: 245_760, note: "MiniMax abab 系列兜底" },
};

/** 找不到时的兜底值。128k 是当下主流模型的"中位数"，配合 UI 提示用户去设置。 */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * 内置表的 lowercase-keyed 视图，仅供 `lookupInMap` 用。
 *
 * 为什么需要：
 * - `MODEL_CONTEXT_WINDOWS` 里有些 key 是混合大小写（如 "MiniMax-M2.7"）。
 * - 查询时输入端已经 `.toLowerCase()` 了，但 map key 保持原样，会导致
 *   "MiniMax-M2.7"（AGNO 返回）→ "MiniMax-m2.7"（lower 后）跟存的
 *   "MiniMax-M2.7" 对不上，前缀匹配也失败，掉进兜底。
 * - 在 module init 时把 key 全 lowercase 一遍，lookup 时就不用关心原 key
 *   大小写；`MODEL_CONTEXT_WINDOWS` 导出保持原样（用于展示 / 调试）。
 */
const LOOKUP_BUILTIN: Record<string, ModelContextEntry> = (() => {
  const out: Record<string, ModelContextEntry> = {};
  for (const [k, v] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    out[k.toLowerCase()] = v;
  }
  return out;
})();

interface CachedConfig {
  fetchedAt: number;
  version: number;
  models: Record<string, ModelContextEntry>;
}

/**
 * 远程配置加载状态（仅 module 内可变）。
 * `remoteWindows === null` 表示"还没成功加载过"（fetch 未完成或失败），
 * 此时 `getContextWindow()` 直接走内置 map + 默认值。
 */
let remoteWindows: Record<string, ModelContextEntry> | null = null;
let loadPromise: Promise<void> | null = null;

/**
 * 把 model id 在给定 map 上做"精确匹配 + 最长前缀匹配"。
 * 命中返回 contextWindow，未命中返回 null。
 */
function lookupInMap(
  id: string,
  map: Record<string, ModelContextEntry>
): number | null {
  const exact = map[id];
  if (exact) return exact.contextWindow;

  let bestKey: string | null = null;
  let bestLen = -1;
  for (const key of Object.keys(map)) {
    if (id === key) continue;
    if (
      id.startsWith(key + "-") ||
      id.startsWith(key + ".") ||
      id.startsWith(key + ":")
    ) {
      if (key.length > bestLen) {
        bestLen = key.length;
        bestKey = key;
      }
    }
  }
  if (bestKey) return map[bestKey]!.contextWindow;
  return null;
}

/**
 * 从 model id 查 context window。
 *
 * 匹配规则（按数据源顺序）：
 *   1) 远程 overlay（如果已加载）—— 精确 → 前缀
 *   2) 内置 map —— 精确 → 前缀
 *   3) DEFAULT_CONTEXT_WINDOW
 *
 * 为什么用最长前缀：模型 id 经常带日期 / 后缀（"gpt-4o-2024-08-06"、
 * "claude-3-5-sonnet-20241022"），但短前缀容易误伤（比如 "o3" 可能误命中
 * "o3-mini" 之前的 "o1/o1-mini/o1-preview" 等等）。用最长前缀能减少这种碰撞。
 */
export function getContextWindow(modelId: string | null | undefined): number {
  if (!modelId) return DEFAULT_CONTEXT_WINDOW;
  const id = String(modelId).trim().toLowerCase();
  if (!id) return DEFAULT_CONTEXT_WINDOW;

  if (remoteWindows) {
    const r = lookupInMap(id, remoteWindows);
    if (r !== null) return r;
  }

  const b = lookupInMap(id, LOOKUP_BUILTIN);
  if (b !== null) return b;

  return DEFAULT_CONTEXT_WINDOW;
}

/** 把 token 数格式化成简短可读字符串：1234 → "1.2k"，2_000_000 → "2.0M" */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

// ───────────────────────── remote config loader ─────────────────────────

function readCache(): CachedConfig | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedConfig;
    if (
      typeof parsed?.fetchedAt !== "number" ||
      typeof parsed?.version !== "number" ||
      typeof parsed?.models !== "object" ||
      parsed.models === null
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(c: CachedConfig): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    // ignore quota errors
  }
}

function isStale(c: CachedConfig, now: number = Date.now()): boolean {
  return now - c.fetchedAt > CACHE_TTL_MS;
}

/**
 * 把 models.dev 的嵌套结构 flatten 成 `{ [bareModelId]: ModelContextEntry }`。
 *
 * 步骤：
 *   1. 顶层是 provider map；过滤掉 *-token-plan / *-coding-plan / *-cn / *-coding
 *   2. 遍历每个 provider.models，按裸 model id（不是 `provider/model`）做 key
 *   3. 取 `model.limit.context`；缺失 / 非正整数 → 跳过该条
 *   4. note 拼成 `"<providerName> (<releaseDate>)"`
 *   5. 跨 provider 同名 model → 第一次出现获胜（实际不会冲突）
 *
 * 失败时返回 null（让上层走 cache fallback）。
 */
function flattenModelsDevCatalog(
  raw: unknown
): { models: Record<string, ModelContextEntry>; count: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const providers = raw as Record<string, unknown>;

  const cleaned: Record<string, ModelContextEntry> = {};
  let count = 0;

  for (const [providerId, providerVal] of Object.entries(providers)) {
    if (!isCanonicalProvider(providerId)) continue;
    if (!providerVal || typeof providerVal !== "object") continue;
    const provider = providerVal as Partial<ModelsDevProvider>;
    const models = provider.models;
    if (!models || typeof models !== "object") continue;

    const providerName = provider.name ?? providerId;

    for (const [modelId, modelVal] of Object.entries(
      models as Record<string, unknown>
    )) {
      if (!modelVal || typeof modelVal !== "object") continue;
      const m = modelVal as Partial<ModelsDevModel>;
      const ctx = m.limit?.context;
      if (typeof ctx !== "number" || !Number.isInteger(ctx) || ctx <= 0) continue;
      // key 一律 lowercase，跟内置表一致（让 lookupInMap 只对输入做 toLowerCase）
      const lk = modelId.toLowerCase();
      // dedup：第一次出现获胜（同名 model 跨 provider 实际极少见）
      if (cleaned[lk]) continue;

      cleaned[lk] = {
        contextWindow: ctx,
        note: `${providerName}${m.release_date ? ` (${m.release_date})` : ""}`,
      };
      count++;
    }
  }

  if (count === 0) return null;
  return { models: cleaned, count };
}

/**
 * 启动时调用一次：拉远程 catalog 并合并进内存。
 *
 * 流程：
 *   1. 读 localStorage 缓存；新鲜（< 24h）就直接用，不发请求
 *   2. 缓存缺失或过期 → fetch https://models.dev/api.json
 *      - 成功 → flatten + 写缓存、采用
 *      - 失败 + 有 stale cache → 用 stale cache（离线救生圈）
 *      - 失败 + 无缓存 → 不动 remoteWindows（仍走内置 map）
 *
 * 并发安全：多次调用只触发一次 fetch，重复 await 直接复用同一个 Promise。
 */
export function loadRemoteContextWindows(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const cached = readCache();

    if (cached && !isStale(cached)) {
      remoteWindows = cached.models;
      return;
    }

    try {
      const resp = await fetch(MODELS_DEV_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json: unknown = await resp.json();
      const flattened = flattenModelsDevCatalog(json);
      if (!flattened) throw new Error("invalid catalog");
      writeCache({
        fetchedAt: Date.now(),
        // count 作为 version 字段（schema 不强约束，只要单调可区分新旧即可）
        version: flattened.count,
        models: flattened.models,
      });
      remoteWindows = flattened.models;
    } catch {
      // 失败时：stale cache 仍可用，避免离线场景下回退到内置 map
      if (cached) remoteWindows = cached.models;
    }
  })();
  return loadPromise;
}

/**
 * 远程配置的加载状态（暴露给 UI 用于显示"已更新于 N 天前"）。
 * - loaded: 是否成功加载过（fetch 成功 OR 有 cache）
 * - fetchedAt: 当前数据来源的时间戳（fetch 成功 OR 缓存时间）；null = 从未成功
 */
export function getRemoteContextWindowsStatus(): {
  loaded: boolean;
  fetchedAt: number | null;
} {
  const cached = readCache();
  return {
    loaded: remoteWindows !== null,
    fetchedAt: cached?.fetchedAt ?? null,
  };
}

/**
 * 测试用：重置 module 级状态（remoteWindows / loadPromise / localStorage）。
 * 生产代码不应调用。
 */
export function _resetForTesting(): void {
  remoteWindows = null;
  loadPromise = null;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch {
      // ignore
    }
  }
}