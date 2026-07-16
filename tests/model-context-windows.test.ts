/**
 * model-context-windows.ts 测试
 *
 * 覆盖：
 *   - 内置 map 的精确 / 大小写不敏感 / 前缀匹配
 *   - 远程 overlay 优先级（覆盖内置）
 *   - 远程 overlay 缺失某 key 时回落到内置
 *   - localStorage 缓存：新鲜（< 24h）跳过 fetch；过期触发 fetch
 *   - fetch 失败 + 有 stale cache → 用 stale cache
 *   - fetch 失败 + 无 cache → 走内置（remoteWindows 留 null）
 *   - validateConfig：非法 version / 非正整数 contextWindow / 缺字段 → 拒绝
 *
 * Usage:
 *   bun run tests/model-context-windows.test.ts
 */
import {
  DEFAULT_CONTEXT_WINDOW,
  MODEL_CONTEXT_WINDOWS,
  _resetForTesting,
  formatTokenCount,
  getContextWindow,
  getRemoteContextWindowsStatus,
  loadRemoteContextWindows,
} from "../src/lib/model-context-windows";

// —— in-memory localStorage shim (bun 默认没有 localStorage) ——
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string): string | null {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.store.set(k, v);
  }
  removeItem(k: string): void {
    this.store.delete(k);
  }
  clear(): void {
    this.store.clear();
  }
  key(i: number): string | null {
    return Array.from(this.store.keys())[i] ?? null;
  }
  get length(): number {
    return this.store.size;
  }
}
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();

// —— assert framework ——
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed++;
    console.error(`✗ ${msg}`);
  } else {
    console.log(`✓ ${msg}`);
  }
}

interface FetchCall {
  url: string;
}

interface MockFetchResult {
  ok: boolean;
  status?: number;
  body?: unknown;
  throw?: Error;
}

const fetchCalls: FetchCall[] = [];
let nextFetchResult: MockFetchResult = { ok: true, status: 200, body: null };

function mockFetch(
  input: string | URL | Request,
  _init?: RequestInit
): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  fetchCalls.push({ url });
  if (nextFetchResult.throw) {
    return Promise.reject(nextFetchResult.throw);
  }
  return Promise.resolve(
    new Response(
      nextFetchResult.body !== undefined ? JSON.stringify(nextFetchResult.body) : "",
      {
        status: nextFetchResult.status ?? 200,
        headers: { "content-type": "application/json" },
      }
    )
  );
}

function installFetchMock(): void {
  fetchCalls.length = 0;
  nextFetchResult = { ok: true, status: 200, body: null };
  (globalThis as unknown as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
}

const CACHE_KEY = "agno:models-dev-catalog";

function setCache(raw: unknown): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(raw));
}

function clearCache(): void {
  localStorage.removeItem(CACHE_KEY);
}

/**
 * 构造 models.dev 形状的 catalog body：顶层是 provider map，
 * 每个 provider 下面 models[id] 含 limit.context。
 */
function makeValidBody(): unknown {
  return {
    openai: {
      id: "openai",
      name: "OpenAI",
      models: {
        "gpt-4o": { id: "gpt-4o", name: "GPT-4o", limit: { context: 128000 } },
        "gpt-6": { id: "gpt-6", name: "GPT-6", limit: { context: 500000 } },
      },
    },
    alibaba: {
      id: "alibaba",
      name: "Alibaba",
      models: {
        "qwen-long": {
          id: "qwen-long",
          name: "Qwen Long",
          limit: { context: 10_000_000 },
          release_date: "2025-01-26",
        },
      },
    },
  };
}

async function main(): Promise<void> {
  // ─────────────── 1) builtin: exact / case-insensitive / prefix / fallback ───────────────
  console.log("=== builtin map lookup ===");
  {
    _resetForTesting();
    installFetchMock();
    nextFetchResult = { ok: false, status: 404 };
    await loadRemoteContextWindows();

    assert(
      getContextWindow("gpt-4o") === 128_000,
      "exact: gpt-4o → 128000 (builtin)"
    );
    assert(
      getContextWindow("GPT-4O") === 128_000,
      "case-insensitive: GPT-4O → 128000 (builtin)"
    );
    assert(
      getContextWindow("gpt-4o-2024-08-06") === 128_000,
      "longest prefix: gpt-4o-2024-08-06 → gpt-4o (128000)"
    );
    assert(
      getContextWindow("claude-3-5-sonnet-20241022") === 200_000,
      "longest prefix beats shorter: claude-3-5-sonnet-20241022 → claude-3-5-sonnet (200k)"
    );
    assert(
      getContextWindow("unknown-model-xyz") === DEFAULT_CONTEXT_WINDOW,
      `unknown model → DEFAULT (${DEFAULT_CONTEXT_WINDOW})`
    );
    assert(getContextWindow(null) === DEFAULT_CONTEXT_WINDOW, "null → DEFAULT");
    assert(getContextWindow("") === DEFAULT_CONTEXT_WINDOW, "empty → DEFAULT");
    assert(
      getContextWindow("  gpt-4o  ") === 128_000,
      "trimmed: '  gpt-4o  ' → 128000"
    );

    // 最长前缀冲突：o3 应优先于 o3-mini（即使 Object.keys 顺序不固定）
    assert(
      getContextWindow("o3") === 200_000 &&
        getContextWindow("o3-mini") === 200_000,
      "o3 和 o3-mini 都命中各自 key（不是误伤）"
    );

    // 混合大小写 key：内置表里 MiniMax-M2.7 这种 mixed-case key 必须被命中。
    // 之前只在输入端 lowercase、map key 没 lowercase，会让 MiniMax-M2.7 →
    // MiniMax-m2.7 跟存的 MiniMax-M2.7 对不上，误显示 default。
    assert(
      getContextWindow("MiniMax-M2.7") === 192_000,
      "mixed-case key 命中: MiniMax-M2.7 → 192k (builtin)"
    );
    assert(
      getContextWindow("MINIMAX-M2.7") === 192_000,
      "全大写也能命中: MINIMAX-M2.7 → 192k"
    );
    assert(
      getContextWindow("MiniMax-M2.7-snapshot-2026") === 192_000,
      "混合大小写 key 的前缀匹配: MiniMax-M2.7-snapshot-2026 → 192k"
    );
    assert(
      getContextWindow("MiniMax-abab") === 245_760,
      "混合大小写: MiniMax-abab → 245k (builtin)"
    );

    // 新加模型：2026 年发布
    assert(
      getContextWindow("qwen3.6-plus") === 1_000_000,
      "qwen3.6-plus → 1M (builtin)"
    );
    assert(
      getContextWindow("qwen3.6-max") === 262_144,
      "qwen3.6-max → 262k (builtin，跟 models.dev 对齐)"
    );
    assert(
      getContextWindow("doubao-1.5-pro") === 256_000,
      "doubao-1.5-pro → 256k (builtin)"
    );
    assert(
      getContextWindow("doubao-1.5-pro-32k") === 32_000,
      "doubao-1.5-pro-32k → 32k (builtin)"
    );
    assert(
      getContextWindow("MiniMax-M3") === 512_000,
      "MiniMax-M3 → 512k (builtin, mixed-case，跟 models.dev 对齐)"
    );
    assert(
      getContextWindow("MiniMax-M3-snapshot") === 512_000,
      "MiniMax-M3-snapshot 前缀匹配 → 512k"
    );
  }

  // ─────────────── 2) remote overlay 覆盖 builtin ───────────────
  console.log("=== remote overlay takes precedence over builtin ===");
  {
    _resetForTesting();
    installFetchMock();
    nextFetchResult = { ok: true, body: makeValidBody() };
    await loadRemoteContextWindows();

    assert(
      getContextWindow("gpt-4o") === 128_000,
      "gpt-4o 仍在（值与 builtin 一致）"
    );
    assert(getContextWindow("gpt-6") === 500_000, "gpt-6 (仅远程有) → 500k");
    assert(
      getContextWindow("qwen-long") === 10_000_000,
      "qwen-long 远程值覆盖 builtin 10M（值一致，验证走的是 remote）"
    );
    // 远程没有的 key 仍走 builtin
    assert(
      getContextWindow("claude-sonnet-4") === 200_000,
      "remote 没有的 key 走 builtin（claude-sonnet-4 → 200k）"
    );
    assert(
      getContextWindow("totally-unknown-remote-miss") === DEFAULT_CONTEXT_WINDOW,
      "remote 和 builtin 都没有 → DEFAULT"
    );

    // models.dev catalog 里 model id 也是 mixed-case（如 "MyModelX1"、
    // "ProviderX-Pro"），验证 normalize 后能命中
    nextFetchResult = {
      ok: true,
      body: {
        mylab: {
          id: "mylab",
          name: "MyLab",
          models: {
            MyModelX1: { id: "MyModelX1", limit: { context: 333_000 } },
          },
        },
        providerx: {
          id: "providerx",
          name: "ProviderX",
          models: {
            "ProviderX-Pro": { id: "ProviderX-Pro", limit: { context: 555_000 } },
          },
        },
      },
    };
    _resetForTesting();
    await loadRemoteContextWindows();

    assert(
      getContextWindow("MyModelX1") === 333_000,
      "models.dev mixed-case id 命中: MyModelX1 → 333k"
    );
    assert(
      getContextWindow("mymodelx1") === 333_000,
      "models.dev mixed-case id 小写也能命中"
    );
    assert(
      getContextWindow("ProviderX-Pro") === 555_000,
      "models.dev ProviderX-Pro → 555k"
    );

    const status = getRemoteContextWindowsStatus();
    assert(status.loaded === true, "status.loaded === true");
    assert(typeof status.fetchedAt === "number", "status.fetchedAt 是 number");
  }

  // ─────────────── 3) cache：新鲜跳过 fetch ───────────────
  console.log("=== cache: fresh < 24h skips fetch ===");
  {
    _resetForTesting();
    clearCache();
    setCache({
      fetchedAt: Date.now() - 60_000, // 1 分钟前
      version: 1,
      models: { "cached-only": { contextWindow: 99_000 } },
    });
    installFetchMock();
    nextFetchResult = { ok: true, body: makeValidBody() };

    await loadRemoteContextWindows();

    assert(fetchCalls.length === 0, "新鲜 cache 时不发起 fetch");
    assert(
      getContextWindow("cached-only") === 99_000,
      "命中 cache 里的 key"
    );
    assert(
      getContextWindow("gpt-6") === DEFAULT_CONTEXT_WINDOW,
      "cache 里没有、又不 fetch → DEFAULT（不会拉到远程新加的 gpt-6）"
    );
  }

  // ─────────────── 4) cache：过期触发 fetch ───────────────
  console.log("=== cache: stale (>24h) triggers fetch ===");
  {
    _resetForTesting();
    clearCache();
    setCache({
      fetchedAt: Date.now() - 25 * 60 * 60 * 1000, // 25 小时前
      version: 1,
      models: { "stale-key": { contextWindow: 50_000 } },
    });
    installFetchMock();
    nextFetchResult = { ok: true, body: makeValidBody() };

    await loadRemoteContextWindows();

    assert(fetchCalls.length === 1, "stale cache 触发 fetch");
    assert(fetchCalls[0]!.url === "https://models.dev/api.json", "URL 指向 models.dev");
    assert(getContextWindow("gpt-6") === 500_000, "拉到新值后可用");
    assert(
      getContextWindow("stale-key") === DEFAULT_CONTEXT_WINDOW,
      "stale cache 的 key 不再使用（被远程覆盖；这里 stale-key 不在 remote 里 → DEFAULT）"
    );
  }

  // ─────────────── 5) fetch 失败 + 有 stale cache → 用 stale cache ───────────────
  console.log("=== fetch fails + stale cache exists → keep stale cache ===");
  {
    _resetForTesting();
    clearCache();
    setCache({
      fetchedAt: Date.now() - 25 * 60 * 60 * 1000,
      version: 1,
      models: { "offline-key": { contextWindow: 42_000 } },
    });
    installFetchMock();
    nextFetchResult = { ok: false, status: 500 };

    await loadRemoteContextWindows();

    assert(fetchCalls.length === 1, "仍尝试 fetch（stale 时）");
    assert(getContextWindow("offline-key") === 42_000, "fetch 失败但用 stale cache 救生圈");
  }

  // ─────────────── 6) fetch 失败 + 无 cache → 走 builtin ───────────────
  console.log("=== fetch fails + no cache → builtin fallback ===");
  {
    _resetForTesting();
    clearCache();
    installFetchMock();
    nextFetchResult = { ok: false, status: 500 };

    await loadRemoteContextWindows();

    assert(
      getContextWindow("gpt-4o") === 128_000,
      "内置表正常返回（128k）"
    );
    assert(
      getContextWindow("gpt-6") === DEFAULT_CONTEXT_WINDOW,
      "remote 没有、cache 没有 → DEFAULT"
    );

    const status = getRemoteContextWindowsStatus();
    assert(status.loaded === false, "status.loaded === false（远程从未成功）");
    assert(status.fetchedAt === null, "status.fetchedAt === null");
  }

  // ─────────────── 7) fetch 抛异常（network error）—— 静默 ───────────────
  console.log("=== fetch throws (network error) → silent fallback ===");
  {
    _resetForTesting();
    clearCache();
    installFetchMock();
    nextFetchResult = { throw: new Error("NetworkError") };

    // 不应抛
    let threw = false;
    try {
      await loadRemoteContextWindows();
    } catch {
      threw = true;
    }
    assert(!threw, "loadRemoteContextWindows 不向外抛");
    assert(
      getContextWindow("gpt-4o") === 128_000,
      "network error 后内置表仍可用"
    );
  }

  // ─────────────── 8) flattenModelsDevCatalog：拒绝非法 catalog ───────────────
  console.log("=== flattenModelsDevCatalog rejects malformed catalogs ===");
  {
    const cases: Array<{ label: string; body: unknown }> = [
      { label: "non-object root", body: "not json" },
      { label: "no models at all", body: {} },
      {
        label: "all providers are plan variants",
        body: {
          "openai-token-plan": { id: "openai-token-plan", models: {} },
          "anthropic-cn": { id: "anthropic-cn", models: {} },
        },
      },
    ];
    for (const c of cases) {
      _resetForTesting();
      clearCache();
      installFetchMock();
      nextFetchResult = { ok: true, body: c.body };
      await loadRemoteContextWindows();

      // 验证失败 → remoteWindows 留 null（fetch 走 catch 分支）→ builtin 工作
      assert(
        getContextWindow("gpt-4o") === 128_000,
        `${c.label} → 走 builtin fallback`
      );
      const status = getRemoteContextWindowsStatus();
      assert(status.loaded === false, `${c.label} → status.loaded === false`);
    }
  }

  // ─────────────── 9) flatten：跳过坏 entry，保留好的；plan 变体被过滤 ───────────────
  console.log("=== flatten filters bad entries + plan variants ===");
  {
    _resetForTesting();
    clearCache();
    installFetchMock();
    nextFetchResult = {
      ok: true,
      body: {
        openai: {
          id: "openai",
          name: "OpenAI",
          models: {
            good: { id: "good", limit: { context: 123_000 } },
            "bad-negative": { id: "bad-negative", limit: { context: -1 } },
            "bad-zero": { id: "bad-zero", limit: { context: 0 } },
            "bad-missing": { id: "bad-missing", /* no limit */ },
            "bad-no-context": { id: "bad-no-context", limit: { output: 100 } },
          },
        },
        anthropic: {
          id: "anthropic",
          name: "Anthropic",
          models: {
            "claude-good": { id: "claude-good", limit: { context: 200_000 } },
          },
        },
        "openai-token-plan": {
          id: "openai-token-plan",
          models: {
            // plan variant 应该被过滤，不该出现
            "plan-leak": { id: "plan-leak", limit: { context: 999_999 } },
          },
        },
        "alibaba-cn": {
          id: "alibaba-cn",
          models: {
            "cn-leak": { id: "cn-leak", limit: { context: 999_999 } },
          },
        },
      },
    };
    await loadRemoteContextWindows();

    assert(getContextWindow("good") === 123_000, "good entry 保留（openai）");
    assert(getContextWindow("claude-good") === 200_000, "good entry 保留（anthropic）");
    assert(
      getContextWindow("bad-negative") === DEFAULT_CONTEXT_WINDOW,
      "负数 contextWindow 被丢弃"
    );
    assert(
      getContextWindow("bad-zero") === DEFAULT_CONTEXT_WINDOW,
      "0 contextWindow 被丢弃"
    );
    assert(
      getContextWindow("bad-missing") === DEFAULT_CONTEXT_WINDOW,
      "缺 limit 字段被丢弃"
    );
    assert(
      getContextWindow("bad-no-context") === DEFAULT_CONTEXT_WINDOW,
      "limit.context 缺失被丢弃"
    );
    assert(
      getContextWindow("plan-leak") === DEFAULT_CONTEXT_WINDOW,
      "*-token-plan 变体里的 model 被过滤掉"
    );
    assert(
      getContextWindow("cn-leak") === DEFAULT_CONTEXT_WINDOW,
      "*-cn 变体里的 model 被过滤掉"
    );

    const status = getRemoteContextWindowsStatus();
    assert(status.loaded === true, "部分非法但整体通过 → status.loaded === true");
  }

  // ─────────────── 9b) cross-provider 同名 model dedup：第一次出现获胜 ───────────────
  console.log("=== cross-provider dedup ===");
  {
    _resetForTesting();
    clearCache();
    installFetchMock();
    nextFetchResult = {
      ok: true,
      body: {
        first: {
          id: "first",
          name: "First",
          models: { "shared-id": { id: "shared-id", limit: { context: 100_000 } } },
        },
        second: {
          id: "second",
          name: "Second",
          models: { "shared-id": { id: "shared-id", limit: { context: 200_000 } } },
        },
      },
    };
    await loadRemoteContextWindows();

    assert(
      getContextWindow("shared-id") === 100_000,
      "同名 model 跨 provider 时第一次出现获胜（first）"
    );
  }

  // ─────────────── 10) 并发安全：同时多次调用只 fetch 一次 ───────────────
  console.log("=== concurrent loadRemoteContextWindows() de-duplicates ===");
  {
    _resetForTesting();
    clearCache();
    installFetchMock();
    nextFetchResult = { ok: true, body: makeValidBody() };

    await Promise.all([
      loadRemoteContextWindows(),
      loadRemoteContextWindows(),
      loadRemoteContextWindows(),
    ]);

    assert(fetchCalls.length === 1, `3 个并发调用只 fetch 一次（实际 ${fetchCalls.length}）`);
  }

  // ─────────────── 11) formatTokenCount ───────────────
  console.log("=== formatTokenCount ===");
  {
    assert(formatTokenCount(0) === "0", "0 → '0'");
    assert(formatTokenCount(-5) === "0", "负数 → '0'");
    assert(formatTokenCount(NaN) === "0", "NaN → '0'");
    assert(formatTokenCount(999) === "999", "<1k → 整数");
    assert(formatTokenCount(1234) === "1.2k", "1.2k");
    assert(formatTokenCount(1_234_567) === "1.2M", "1.2M");
    assert(formatTokenCount(2_000_000) === "2.0M", "2.0M");
    assert(formatTokenCount(128_000) === "128.0k", "128k → '128.0k'");
  }

  // ─────────────── 12) sanity: builtin map 至少 100 个 key ───────────────
  console.log("=== sanity ===");
  {
    const count = Object.keys(MODEL_CONTEXT_WINDOWS).length;
    assert(count >= 100, `内置表 ≥ 100 个 key（实际 ${count}）`);
  }

  console.log("\n========================================");
  if (failed === 0) {
    console.log("All model-context-windows tests passed.");
  } else {
    console.error(`${failed} assertion(s) failed.`);
  }
}

main()
  .then(() => {
    process.exit(failed === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("test runner crashed:", err);
    process.exit(1);
  });