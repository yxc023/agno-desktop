/**
 * AGNO AgentOS HTTP 客户端
 *
 * 负责：
 * - 构造正确的请求（含 base URL / auth header）
 * - 处理 SSE 流式响应
 * - 错误归一化
 */

import type {
  AgAgentResponse,
  AgApproval,
  AgApprovalResolveRequest,
  AgConfigResponse,
  AgContinueRunRequest,
  AgCreateSessionRequest,
  AgHealthResponse,
  AgInfoResponse,
  AgPaginatedResponse,
  AgResumeRunRequest,
  AgRunAgentRequest,
  AgRunResponse,
  AgSessionDetail,
  AgSessionSummary,
  AgTeamResponse,
  AgWorkflowResponse,
} from "./agno-types";
import { type AgSSEEvent, parseSSE, parseSSEData } from "./sse-parser";

export interface AgnoClientOptions {
  baseUrl: string;
  token?: string | null;
  /** 可选自定义 fetcher（注入测试或拦截器） */
  fetcher?: typeof fetch;
}

export class AgnoClient {
  readonly baseUrl: string;
  private token: string | null;
  private fetcher: typeof fetch;

  constructor(opts: AgnoClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token ?? null;
    this.fetcher = opts.fetcher ?? fetch.bind(globalThis);
  }

  setToken(token: string | null) {
    this.token = token;
  }

  private buildUrl(path: string, query?: Record<string, any>): string {
    const isRelative = this.baseUrl.startsWith("/");
    const fullPath =
      this.baseUrl.replace(/\/+$/, "") +
      (path.startsWith("/") ? path : `/${path}`);
    const url = isRelative
      ? new URL(fullPath, window.location.origin)
      : new URL(fullPath);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async request<T>(
    path: string,
    init?: RequestInit & { query?: Record<string, any> }
  ): Promise<T> {
    const { query, ...rest } = init ?? {};
    const url = this.buildUrl(path, query);
    const headers = new Headers(rest.headers);
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    if (rest.body && !(rest.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const res = await this.fetcher(url, { ...rest, headers });
    if (!res.ok) {
      let detail: any = null;
      try {
        detail = await res.json();
      } catch {
        detail = await res.text().catch(() => null);
      }
      const err = new Error(
        `AGNO ${res.status} ${res.statusText} on ${path}: ${
          typeof detail === "string" ? detail : JSON.stringify(detail)
        }`
      ) as Error & { status?: number; detail?: any };
      err.status = res.status;
      err.detail = detail;
      throw err;
    }
    if (res.status === 204) return undefined as T;
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      return (await res.json()) as T;
    }
    return (await res.text()) as unknown as T;
  }

  // -------- 基础端点 --------

  info(): Promise<AgInfoResponse> {
    return this.request<AgInfoResponse>("/info");
  }

  config(): Promise<AgConfigResponse> {
    return this.request<AgConfigResponse>("/config");
  }

  health(): Promise<AgHealthResponse> {
    return this.request<AgHealthResponse>("/health");
  }

  // -------- Agents --------

  listAgents(): Promise<AgAgentResponse[]> {
    return this.request<AgAgentResponse[]>("/agents");
  }

  getAgent(id: string): Promise<AgAgentResponse> {
    return this.request<AgAgentResponse>(`/agents/${encodeURIComponent(id)}`);
  }

  // -------- Teams --------

  listTeams(): Promise<AgTeamResponse[]> {
    return this.request<AgTeamResponse[]>("/teams");
  }

  // -------- Workflows --------

  listWorkflows(): Promise<AgWorkflowResponse[]> {
    return this.request<AgWorkflowResponse[]>("/workflows");
  }

  // -------- Sessions --------

  listSessions(params?: {
    type?: "agent" | "team" | "workflow";
    component_id?: string;
    user_id?: string;
    session_name?: string;
    limit?: number;
    page?: number;
    sort_by?: string;
    sort_order?: "asc" | "desc";
  }): Promise<AgPaginatedResponse<AgSessionSummary>> {
    return this.request<AgPaginatedResponse<AgSessionSummary>>("/sessions", {
      query: params,
    });
  }

  createSession(body: AgCreateSessionRequest): Promise<AgSessionDetail> {
    return this.request<AgSessionDetail>("/sessions", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }

  getSession(
    sessionId: string,
    type?: "agent" | "team" | "workflow"
  ): Promise<AgSessionDetail> {
    return this.request<AgSessionDetail>(`/sessions/${encodeURIComponent(sessionId)}`, {
      query: { type },
    });
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.request<void>(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  }

  renameSession(sessionId: string, name: string): Promise<AgSessionDetail> {
    return this.request<AgSessionDetail>(
      `/sessions/${encodeURIComponent(sessionId)}/rename`,
      {
        method: "POST",
        body: JSON.stringify({ session_name: name }),
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  updateSession(
    sessionId: string,
    body: Partial<AgCreateSessionRequest>
  ): Promise<AgSessionDetail> {
    return this.request<AgSessionDetail>(
      `/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  getSessionRuns(sessionId: string): Promise<AgRunResponse[]> {
    return this.request<AgRunResponse[]>(
      `/sessions/${encodeURIComponent(sessionId)}/runs`
    );
  }

  // -------- Run streaming (核心) --------

  /**
   * 发起一个 agent run 并返回 SSE 事件流
   */
  async *runAgent(
    agentId: string,
    body: AgRunAgentRequest,
    signal?: AbortSignal
  ): AsyncGenerator<AgSSEEvent> {
    const url = this.buildUrl(`/agents/${encodeURIComponent(agentId)}/runs`);
    const headers = new Headers();
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);

    const formData = new FormData();
    formData.append("message", body.message);
    formData.append("stream", String(body.stream ?? true));
    if (body.session_id) formData.append("session_id", body.session_id);
    if (body.user_id) formData.append("user_id", body.user_id);
    if (body.version) formData.append("version", body.version);
    if (body.background) formData.append("background", "true");
    if (body.factory_input) {
      formData.append("factory_input", JSON.stringify(body.factory_input));
    }
    if (body.files?.length) {
      for (const f of body.files) formData.append("files", f, f.name);
    }

    const res = await this.fetcher(url, {
      method: "POST",
      body: formData,
      headers,
      signal,
    });
    if (!res.ok) {
      let detail: any = null;
      try {
        detail = await res.json();
      } catch {
        detail = await res.text();
      }
      throw new Error(
        `Run agent failed: ${res.status} ${JSON.stringify(detail)}`
      );
    }
    yield* parseSSE(res);
  }

  async *continueAgentRun(
    agentId: string,
    runId: string,
    body: AgContinueRunRequest,
    signal?: AbortSignal
  ): AsyncGenerator<AgSSEEvent> {
    const url = this.buildUrl(
      `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/continue`
    );
    const headers = new Headers();
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);

    const fd = new FormData();
    if (body.tools?.length) fd.append("tools", JSON.stringify(body.tools));
    if (body.session_id) fd.append("session_id", body.session_id);
    if (body.user_id) fd.append("user_id", body.user_id);
    fd.append("stream", String(body.stream ?? true));
    if (body.background) fd.append("background", "true");

    const res = await this.fetcher(url, {
      method: "POST",
      body: fd,
      headers,
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => null);
      throw new Error(`Continue run failed: ${res.status} ${detail}`);
    }
    yield* parseSSE(res);
  }

  async *resumeAgentRun(
    agentId: string,
    runId: string,
    body: AgResumeRunRequest,
    signal?: AbortSignal
  ): AsyncGenerator<AgSSEEvent> {
    const url = this.buildUrl(
      `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/resume`
    );
    const headers = new Headers();
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);

    const fd = new FormData();
    if (body.last_event_index != null) {
      fd.append("last_event_index", String(body.last_event_index));
    }
    if (body.session_id) fd.append("session_id", body.session_id);

    const res = await this.fetcher(url, {
      method: "POST",
      body: fd,
      headers,
      signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => null);
      throw new Error(`Resume run failed: ${res.status} ${detail}`);
    }
    yield* parseSSE(res);
  }

  cancelAgentRun(agentId: string, runId: string): Promise<void> {
    return this.request<void>(
      `/agents/${encodeURIComponent(agentId)}/runs/${encodeURIComponent(runId)}/cancel`,
      { method: "POST" }
    );
  }

  // -------- Approvals --------

  listApprovals(params?: {
    run_id?: string;
    status?: string;
    user_id?: string;
    agent_id?: string;
  }): Promise<AgApproval[]> {
    return this.request<AgApproval[]>("/approvals", { query: params });
  }

  getApproval(id: string): Promise<AgApproval> {
    return this.request<AgApproval>(`/approvals/${encodeURIComponent(id)}`);
  }

  resolveApproval(id: string, body: AgApprovalResolveRequest): Promise<AgApproval> {
    return this.request<AgApproval>(`/approvals/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }
}

export { parseSSEData };