/**
 * tests/highlight-client.test.ts — src/lib/highlight-client.ts
 *
 * 覆盖：
 *   - Worker 客户端的 request 协议：postMessage → response → resolve
 *   - per-key supersede：同 key 第二次 request 触发旧 promise reject
 *   - 缓存命中：相同 key 不发新请求
 *   - error response → fallback 到 escapeHtml(code)
 *   - destroy 后 request 直接返回 escape
 */

import {
  createWorkerClient,
  type WorkerLike,
} from "../src/lib/highlight-client";

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.log(`✗ ${msg}`);
    failed++;
  }
}

/** 内存中的 mock Worker：捕获 postMessage，模拟响应。 */
function makeMockWorker(): {
  worker: WorkerLike;
  send: (data: unknown) => void;
  posted: unknown[];
} {
  const posted: unknown[] = [];
  const listeners: Record<
    "message" | "error",
    Set<(event: { data?: unknown; message?: string }) => void>
  > = { message: new Set(), error: new Set() };

  const worker: WorkerLike = {
    postMessage(msg) {
      posted.push(msg);
    },
    addEventListener(type, listener) {
      listeners[type].add(listener);
    },
    removeEventListener(type, listener) {
      listeners[type].delete(listener);
    },
    terminate() {
      listeners.message.clear();
      listeners.error.clear();
    },
  };

  function send(data: unknown) {
    for (const l of listeners.message) l({ data });
  }
  return { worker, send, posted };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log("=== Worker 客户端: 基本请求/响应 ===");
  {
    const { worker, send, posted } = makeMockWorker();
    const client = createWorkerClient(worker);
    let resolved: string | null = null;
    let rejected: Error | null = null;
    const p = client
      .request("const x = 1", "typescript", "k1")
      .then((h) => (resolved = h), (e) => (rejected = e as Error));
    await delay(0);
    assert(posted.length === 1, "request 发出 1 条 postMessage");
    const req = posted[0] as { id: number; code: string; language: string };
    assert(typeof req.id === "number", "postMessage 带数字 id");
    assert(req.code === "const x = 1", "postMessage 带 code");
    assert(req.language === "typescript", "postMessage 带 language");
    send({ id: req.id, html: "<span>highlighted</span>" });
    await p;
    assert(resolved === "<span>highlighted</span>", "response → resolve(html)");
    assert(rejected === null, "不应该 reject");
    client.destroy();
  }

  await delay(0);
  console.log("=== Worker 客户端: per-key supersede ===");
  {
    const { worker, send, posted } = makeMockWorker();
    const client = createWorkerClient(worker);
    const p1 = client.request("v1", "ts", "key");
    const req1 = posted[0] as { id: number };
    const p2 = client.request("v2", "ts", "key");
    const req2 = posted[1] as { id: number };
    assert(req1.id < req2.id, "id 单调递增");
    // 先响应 req1（已 supersede）→ 应被丢弃（client 内部 .catch 兜底为 fallback）
    send({ id: req1.id, html: "old" });
    // 再响应 req2（latest）→ resolve
    send({ id: req2.id, html: "new" });
    const [r1, r2] = await Promise.all([p1, p2]);
    // r1 因 supersede + .catch fallback → 退到 escapeHtml("v1") = "v1"
    assert(r1 === "v1", "supersede 的旧 request 通过 .catch fallback 到 escapeHtml(code)");
    assert(r2 === "new", "latest request resolve 新值（不会被 stale 覆盖）");
    client.destroy();
  }

  await delay(0);
  console.log("=== Worker 客户端: 缓存命中 ===");
  {
    const { worker, send, posted } = makeMockWorker();
    const client = createWorkerClient(worker);
    const p1 = client.request("x", "ts", "k");
    const req1 = posted[0] as { id: number };
    send({ id: req1.id, html: "<hl>x</hl>" });
    await p1;
    const html = await client.request("x", "ts", "k");
    assert(html === "<hl>x</hl>", "缓存命中返回原值");
    assert(posted.length === 1, "缓存命中不发新请求");
    client.destroy();
  }

  await delay(0);
  console.log("=== Worker 客户端: error response → fallback ===");
  {
    const { worker, send, posted } = makeMockWorker();
    const client = createWorkerClient(worker);
    const p = client.request("<x>", "ts", "k");
    const req = posted[0] as { id: number };
    send({ id: req.id, error: "language not found" });
    const html = await p;
    assert(html === "&lt;x&gt;", "error → fallback escapeHtml(code)");
    client.destroy();
  }

  await delay(0);
  console.log("=== Worker 客户端: destroy 后直接 escape ===");
  {
    const { worker } = makeMockWorker();
    const client = createWorkerClient(worker);
    client.destroy();
    const html = await client.request("<x>", "ts", "k");
    assert(html === "&lt;x&gt;", "destroy 后立即返回 escape");
  }

  await delay(0);
  console.log("=== Worker 客户端: id 严格递增 ===");
  {
    const { worker, posted } = makeMockWorker();
    const client = createWorkerClient(worker);
    void client.request("a", "ts", "k1");
    void client.request("b", "ts", "k2");
    void client.request("c", "ts", "k3");
    await delay(0);
    const ids = posted.map((m) => (m as { id: number }).id);
    assert(ids[0]! < ids[1]! && ids[1]! < ids[2]!, "id 序列：k1 < k2 < k3");
    client.destroy();
  }

  await delay(0);
  console.log("=== Worker 客户端: supersede 不同 key 不互相影响 ===");
  {
    const { worker, send, posted } = makeMockWorker();
    const client = createWorkerClient(worker);
    const p1 = client.request("v1", "ts", "keyA");
    const req1 = posted[0] as { id: number };
    const p2 = client.request("v2", "ts", "keyB");
    const req2 = posted[1] as { id: number };
    // 响应顺序不影响：req1 是 keyA 的 latest，req2 是 keyB 的 latest
    send({ id: req2.id, html: "B-html" });
    send({ id: req1.id, html: "A-html" });
    const [r1, r2] = await Promise.all([p1, p2]);
    assert(r1 === "A-html", "keyA 的 latest req1 → resolve A-html");
    assert(r2 === "B-html", "keyB 的 latest req2 → resolve B-html");
    client.destroy();
  }
}

main()
  .then(() => {
    if (failed > 0) {
      console.error(`\n${failed} assertion(s) failed`);
      process.exit(1);
    } else {
      console.log("\nall assertions passed");
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });