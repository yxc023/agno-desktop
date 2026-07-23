/**
 * tests/sse-parser.test.ts — src/lib/sse-parser.ts 直接覆盖
 *
 * 这是 AGNO AgentOS 流式管道的入口；之前没有任何直接单测，全部通过 ChatRunner
 * 间接覆盖。新增这个文件是因为：
 *   - parseSSE 错了会导致整个 SSE 流静默不工作
 *   - 它有几个微妙的行为（多行 data 拼接、注释行 `:foo`、trailing buffer），
 *     容易在重构时被破坏
 *
 * 跑法：
 *   bun run tests/sse-parser.test.ts
 */
import { parseSSE, parseSSEData, type AgSSEEvent } from "../src/lib/sse-parser";

let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.log(`✗ ${msg}`);
    failed++;
  }
}
function eq<T>(actual: T, expected: T, msg: string): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

/** 构造一个能逐块 yield 的 Response（模拟 fetch + ReadableStream）。 */
function makeResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

/** 把 AsyncGenerator 转成数组（方便断言）。 */
async function collect(gen: AsyncGenerator<AgSSEEvent>): Promise<AgSSEEvent[]> {
  const out: AgSSEEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

async function main(): Promise<void> {
  console.log("=== parseSSE: 基础单事件 ===");
  {
    const events = await collect(parseSSE(makeResponse(["event: foo\ndata: hello\n\n"])));
    eq(events.length, 1, "单事件 yield 一次");
    eq(events[0].event, "foo", "event field");
    eq(events[0].data, "hello", "data field");
  }

  console.log("\n=== parseSSE: 多事件 ===");
  {
    const events = await collect(
      parseSSE(
        makeResponse([
          "event: a\ndata: 1\n\nevent: b\ndata: 2\n\n",
        ])
      )
    );
    eq(events.length, 2, "两事件 yield 两次");
    eq(events[0].event, "a", "first event");
    eq(events[1].event, "b", "second event");
  }

  console.log("\n=== parseSSE: 多行 data 用 \\n 拼接 ===");
  {
    const events = await collect(
      parseSSE(
        makeResponse([
          "event: multiline\ndata: line1\ndata: line2\ndata: line3\n\n",
        ])
      )
    );
    eq(events[0].data, "line1\nline2\nline3", "多行 data 用 \\n 拼接");
  }

  console.log("\n=== parseSSE: 注释行（以 : 开头）跳过 ===");
  {
    const events = await collect(
      parseSSE(
        makeResponse([
          ": this is a comment\nevent: ping\ndata: pong\n\n",
        ])
      )
    );
    eq(events.length, 1, "注释不产生 event");
    eq(events[0].event, "ping", "event 正确");
    eq(events[0].data, "pong", "data 正确");
  }

  console.log("\n=== parseSSE: id / retry 字段 ===");
  {
    const events = await collect(
      parseSSE(
        makeResponse([
          "id: 42\nevent: msg\ndata: hi\nretry: 5000\n\n",
        ])
      )
    );
    eq(events[0].id, "42", "id 字段");
    eq(events[0].retry, 5000, "retry 字段");
  }

  console.log("\n=== parseSSE: 跨 chunk 边界 ===");
  {
    // 一个事件被切成两个 chunk —— 应该等 \\n\\n 到齐再 yield
    const events = await collect(
      parseSSE(
        makeResponse([
          "event: split\ndata: pa",
          "rt1\n\n",
        ])
      )
    );
    eq(events.length, 1, "跨 chunk 仍 yield 一次");
    eq(events[0].data, "part1", "data 拼接正确");
  }

  console.log("\n=== parseSSE: chunk 边界在 \\n\\n 中间 ===");
  {
    // 第一个 chunk 末尾是 data: hello\n，第 2 个 chunk 开头是 \n
    const events = await collect(
      parseSSE(
        makeResponse([
          "event: split2\ndata: hello\n",
          "\n",
        ])
      )
    );
    eq(events.length, 1, "chunk 在 \\n 中间也能正确切分");
    eq(events[0].data, "hello", "data 完整");
  }

  console.log("\n=== parseSSE: trailing buffer（没有结尾 \\n\\n）===");
  {
    // 流结束时 buffer 残留但非空 —— 仍应 yield
    const events = await collect(
      parseSSE(
        makeResponse([
          "event: tail\ndata: last\n",
        ])
      )
    );
    eq(events.length, 1, "trailing data 也 yield");
    eq(events[0].data, "last", "trailing data 正确");
  }

  console.log("\n=== parseSSE: 空事件（无 data）跳过 ===");
  {
    // 只有 event: 没有 data 的事件不应该 yield
    const events = await collect(
      parseSSE(
        makeResponse([
          "event: keepalive\n\nevent: real\ndata: ok\n\n",
        ])
      )
    );
    eq(events.length, 1, "空 data 事件跳过");
    eq(events[0].event, "real", "保留有 data 的事件");
  }

  console.log("\n=== parseSSE: 多事件 + chunk 在 event/data 之间 ===");
  {
    // 两个完整事件，第一个末尾 \\n\\n 跨两个 chunk
    const events = await collect(
      parseSSE(
        makeResponse([
          "event: e1\ndata: d1\n",
          "\nevent: e2\ndata: d2\n\n",
        ])
      )
    );
    eq(events.length, 2, "两个事件正确切分");
    eq(events[0].data, "d1", "e1.data");
    eq(events[1].data, "d2", "e2.data");
  }

  console.log("\n=== parseSSE: 没有 body 抛错 ===");
  {
    const empty = new Response(null, { status: 200 });
    let threw = false;
    try {
      await collect(parseSSE(empty));
    } catch {
      threw = true;
    }
    assert(threw, "response.body=null 时抛错");
  }

  console.log("\n=== parseSSEData: 成功 parse ===");
  {
    const obj = parseSSEData<{ x: number }>({ data: '{"x":1}' });
    eq(obj?.x, 1, "JSON 字符串 parse 成功");
  }

  console.log("\n=== parseSSEData: 失败 / 空 → null ===");
  {
    eq(parseSSEData({ data: "not json" }), null, "非法 JSON → null");
    eq(parseSSEData({ data: "" }), null, "空 data → null");
  }

  console.log(
    `\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});