/**
 * SSE 解析器：从 fetch ReadableStream 解析 Server-Sent Events
 *
 * AGNO AgentOS 使用的就是标准 SSE:
 *   event: RunContent
 *   data: {"event":"RunContent","delta":"hello"}
 *   id: 12
 *
 * 事件以两个换行（\n\n）分隔。
 */

export interface AgSSEEvent {
  event?: string;
  data: string;
  id?: string;
  retry?: number;
}

const FIELD_RE = /^([a-zA-Z][a-zA-Z0-9_-]*): ?(.*)$/;

export async function* parseSSE(
  response: Response
): AsyncGenerator<AgSSEEvent> {
  if (!response.body) {
    throw new Error("Response has no body to parse SSE from");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        const event: AgSSEEvent = { data: "" };
        const lines = raw.split("\n");

        for (const line of lines) {
          if (!line || line.startsWith(":")) continue;
          const m = FIELD_RE.exec(line);
          if (!m) continue;
          const [, field, value] = m;
          switch (field) {
            case "event":
              event.event = value;
              break;
            case "data":
              event.data += (event.data ? "\n" : "") + value;
              break;
            case "id":
              event.id = value;
              break;
            case "retry":
              event.retry = parseInt(value, 10);
              break;
          }
        }

        if (event.data) {
          yield event;
        }
      }
    }

    // 处理尾部 buffer
    if (buffer.trim()) {
      const event: AgSSEEvent = { data: "" };
      for (const line of buffer.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const m = FIELD_RE.exec(line);
        if (!m) continue;
        const [, field, value] = m;
        if (field === "event") event.event = value;
        else if (field === "data") event.data += (event.data ? "\n" : "") + value;
        else if (field === "id") event.id = value;
      }
      if (event.data) yield event;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

export function parseSSEData<T = any>(event: AgSSEEvent): T | null {
  if (!event.data) return null;
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}