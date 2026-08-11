import type {
  AgentPlatform,
  Requirement,
  SessionStatus,
  StageDefinition,
  StageKind,
} from "./types";

const now = Date.now();
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

function short(s: string): string {
  return s.slice(0, 7);
}

export const PLATFORM_LABEL: Record<AgentPlatform, string> = {
  agno: "AGNO",
  "claude-code": "Claude Code",
  opencode: "opencode",
  codex: "Codex",
  human: "Human",
};

export const STATUS_LABEL: Record<SessionStatus, string> = {
  running: "running",
  paused: "paused",
  ask_user: "ask_user",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

export const STAGE_LABEL: Record<StageKind, string> = {
  plan: "plan",
  do: "do",
  check: "check",
  deliver: "deliver",
};

export const STAGE_LABEL_CN: Record<StageKind, string> = {
  plan: "计划",
  do: "执行",
  check: "检查",
  deliver: "交付",
};

export const STAGE_DEFINITIONS: Record<StageKind, StageDefinition> = {
  plan: {
    kind: "plan",
    description: "澄清、调研、方案选型",
    suggestedAgents: [
      { name: "Claude Code", platform: "claude-code" },
      { name: "code-search", platform: "opencode" },
    ],
  },
  do: {
    kind: "do",
    description: "实现、改动、提交",
    suggestedAgents: [
      { name: "opencode", platform: "opencode" },
      { name: "pr-review-team", platform: "agno" },
    ],
  },
  check: {
    kind: "check",
    description: "评审、测试、缺陷修复",
    suggestedAgents: [
      { name: "pr-review-team", platform: "agno" },
      { name: "Claude Code", platform: "claude-code" },
    ],
  },
  deliver: {
    kind: "deliver",
    description: "发布、文档收尾、归档",
    suggestedAgents: [
      { name: "Claude Code", platform: "claude-code" },
    ],
  },
};

// ============================================================================
// REQUIREMENTS（含 sessions 子数组）
// ============================================================================

export const REQUIREMENTS: Requirement[] = [
  // ---------------------------------------------------------------- REQ-234
  {
    id: "REQ-234",
    title: "Add OTLP tracing to backend-service",
    description:
      "在 backend-service 全链路接入 OpenTelemetry，把 trace 推到内部的 Tempo + Loki。要求：覆盖 HTTP inbound + DB query + 外部 API 调用三层；sampling 在 edge 网关统一做。",
    status: "active",
    createdAt: now - 3 * day,
    updatedAt: now - 4 * minute,
    assignees: [
      { kind: "human", name: "Alice", avatar: "A" },
      { kind: "agent", name: "pr-review-team", platform: "agno" },
      { kind: "agent", name: "code-search", platform: "opencode" },
    ],
    repos: [
      "/Users/alice/work/backend-service",
      "/Users/alice/work/infra-charts",
    ],
    currentStage: "do",
    activities: [
      {
        id: "act-234-1",
        kind: "stage-transition",
        requirementId: "REQ-234",
        at: now - 3 * day,
        fromStage: null,
        toStage: "plan",
        authorType: "human",
        authorName: "Alice",
        reason: "需求已澄清，启动 plan 阶段",
      },
      {
        id: "act-234-2",
        kind: "comment",
        requirementId: "REQ-234",
        at: now - 2 * day - 22 * hour,
        authorType: "human",
        authorName: "Alice",
        content: "OTLP 是不是也应该覆盖 gRPC stream 终止场景？",
        sessionRef: "sess-234-plan-1",
      },
      {
        id: "act-234-3",
        kind: "comment",
        requirementId: "REQ-234",
        at: now - 2 * day - 21 * hour,
        parentId: "act-234-2",
        authorType: "agent",
        authorName: "opencode",
        authorPlatform: "opencode",
        content: "是的，gRPC stream 终止会丢失 trace 上下文。已写入 ADR-002。",
        sessionRef: "sess-234-plan-2",
      },
      {
        id: "act-234-4",
        kind: "agent-note",
        requirementId: "REQ-234",
        at: now - 2 * day - 6 * hour,
        authorType: "agent",
        authorName: "Claude Code",
        authorPlatform: "claude-code",
        content: "调研完成，3 个候选方案对比见 docs/02-research-otlp-options.md。推荐 HTTP/protobuf。",
        sessionRef: "sess-234-plan-1",
      },
      {
        id: "act-234-5",
        kind: "stage-transition",
        requirementId: "REQ-234",
        at: now - 2 * day - 4 * hour,
        fromStage: "plan",
        toStage: "do",
        authorType: "human",
        authorName: "Alice",
        reason: "架构设计 ADR 已定稿，转 do 实施",
      },
      {
        id: "act-234-6",
        kind: "comment",
        requirementId: "REQ-234",
        at: now - 1 * hour,
        authorType: "human",
        authorName: "Alice",
        content: "@pr-review-team 实时盯一下 do-2 这个 session 的 diff，有问题随时打断。",
      },
      {
        id: "act-234-7",
        kind: "agent-note",
        requirementId: "REQ-234",
        at: now - 32 * minute,
        authorType: "agent",
        authorName: "opencode",
        authorPlatform: "opencode",
        content: "do-1 session 已暂停 1h，发现 sampling 链路偶发未透传，正在排查。",
        sessionRef: "sess-234-do-1",
      },
    ],
    documents: [
      {
        filePath: "docs/01-clarification.md",
        title: "需求澄清 · OTLP 接入范围与边界",
        excerpt:
          "明确本次只覆盖 backend-service，不含 edge 网关改写；sampling 决策放在 edge 但本次只实现 backend 端读取 + 透传。已与 SRE 同步口径。",
        kind: "clarification",
        lastEditedBy: "human",
        lastEditedByName: "Alice",
        lastEditedAt: now - 3 * day,
        sizeBytes: 4_200,
        lineCount: 86,
      },
      {
        filePath: "docs/02-research-otlp-options.md",
        title: "调研 · OTLP exporter 选型（otlp/grpc vs otlp/http）",
        excerpt:
          "对比 gRPC vs HTTP/protobuf vs native-Jaeger 三条路径；推荐 HTTP/protobuf，理由：edge 网关已有 LB、避免 gRPC stream 终止策略。决策已写入 ADR-001。",
        kind: "research",
        lastEditedBy: "claude-code",
        lastEditedByName: "Claude Code",
        lastEditedAt: now - 2 * day - 18 * hour,
        sizeBytes: 9_800,
        lineCount: 248,
      },
      {
        filePath: "docs/03-architecture.md",
        title: "架构设计 · 三层 trace 串联",
        excerpt:
          "HTTP inbound → router → handler → db query → external API，每层一个 span；attributes 命名规范见附录 A。",
        kind: "design",
        lastEditedBy: "claude-code",
        lastEditedByName: "Claude Code",
        lastEditedAt: now - 2 * day - 6 * hour,
        sizeBytes: 12_400,
        lineCount: 314,
      },
      {
        filePath: "docs/04-adr-001-sampling.md",
        title: "ADR-001 · sampling 由 edge 统一决策",
        excerpt:
          "Context：如何在不破坏 trace 完整性的前提下控制存储成本。Decision：edge 网关基于 route + 用户等级算 probability，注入 W3C tracestate。",
        kind: "adr",
        lastEditedBy: "opencode",
        lastEditedByName: "opencode",
        lastEditedAt: now - 2 * day - 4 * hour,
        sizeBytes: 5_200,
        lineCount: 132,
      },
      {
        filePath: "docs/05-stage-do-report.md",
        title: "阶段性报告 · do 阶段第 1 天",
        excerpt:
          "已完成 otel middleware 与 db wrapper；sampling 链路偶发未透传，正在排查；预计 do 阶段还需 2 天。",
        kind: "report",
        lastEditedBy: "human",
        lastEditedByName: "Alice",
        lastEditedAt: now - 1 * hour,
        sizeBytes: 3_100,
        lineCount: 78,
      },
      {
        filePath: "docs/06-test-plan.md",
        title: "测试计划",
        excerpt:
          "单元：span 属性完整 + baggage 透传。集成：mock otel collector 收包验证。E2E：trace 在 3 个服务间连贯。",
        kind: "test-plan",
        lastEditedBy: "opencode",
        lastEditedByName: "opencode",
        lastEditedAt: now - 6 * hour,
        sizeBytes: 2_600,
        lineCount: 67,
      },
    ],
    branches: [
      {
        repoPath: "/Users/alice/work/backend-service",
        name: "req/REQ-234/main",
        lastCommitSha: short("a3f9e1b2c4d5"),
        aheadBy: 12,
        behindBy: 3,
        authorType: "agent",
        authorPlatform: "opencode",
        authorName: "opencode",
        updatedAt: now - 18 * minute,
        externalUrl: "https://git.internal/backend-service/-/tree/req/REQ-234/main",
      },
      {
        repoPath: "/Users/alice/work/backend-service",
        name: "req/REQ-234/feat/sampling-edge",
        lastCommitSha: short("7c2b9d8e1f30"),
        aheadBy: 4,
        behindBy: 0,
        authorType: "human",
        authorName: "Alice",
        updatedAt: now - 45 * minute,
        externalUrl: "https://git.internal/backend-service/-/tree/req/REQ-234/feat/sampling-edge",
      },
      {
        repoPath: "/Users/alice/work/infra-charts",
        name: "req/REQ-234/tempo",
        lastCommitSha: short("b1e4c7a9f201"),
        aheadBy: 2,
        behindBy: 1,
        authorType: "human",
        authorName: "Alice",
        updatedAt: now - 1 * hour,
        externalUrl: "https://git.internal/infra-charts/-/tree/req/REQ-234/tempo",
      },
    ],
    mrs: [
      {
        repoPath: "/Users/alice/work/backend-service",
        iid: 142,
        title: "feat(tracing): wire OTLP middleware + db spans",
        status: "draft",
        branch: "req/REQ-234/main",
        targetBranch: "main",
        authorType: "agent",
        authorPlatform: "opencode",
        authorName: "opencode",
        externalUrl: "https://git.internal/backend-service/-/merge_requests/142",
        updatedAt: now - 22 * minute,
      },
    ],
    commits: [
      {
        sha: "a3f9e1b",
        repoPath: "/Users/alice/work/backend-service",
        message: "feat(tracing): wire otel middleware into http router",
        authorType: "agent",
        authorPlatform: "opencode",
        authorName: "opencode",
        timestamp: now - 18 * minute,
        filesChanged: ["src/middleware/otel.ts", "src/router/index.ts"],
      },
      {
        sha: "7c2b9d8",
        repoPath: "/Users/alice/work/backend-service",
        message: "fix(sampling): edge-side probability not propagated",
        authorType: "human",
        authorName: "Alice",
        timestamp: now - 45 * minute,
        filesChanged: ["src/middleware/sampling.ts"],
      },
      {
        sha: "92f0c41",
        repoPath: "/Users/alice/work/backend-service",
        message: "refactor(db): wrap query in traced span",
        authorType: "agent",
        authorPlatform: "opencode",
        authorName: "opencode",
        timestamp: now - 1 * hour,
        filesChanged: ["src/db/traced-query.ts"],
      },
      {
        sha: "4e8b732",
        repoPath: "/Users/alice/work/backend-service",
        message: "docs: sampling strategy rationale",
        authorType: "agent",
        authorPlatform: "claude-code",
        authorName: "Claude Code",
        timestamp: now - 6 * hour,
        filesChanged: ["docs/tracing/sampling-strategy.md"],
      },
      {
        sha: "1c5a2f9",
        repoPath: "/Users/alice/work/backend-service",
        message: "design: otlp architecture diagram",
        authorType: "agent",
        authorPlatform: "claude-code",
        authorName: "Claude Code",
        timestamp: now - 8 * hour,
        filesChanged: ["docs/tracing/otlp-design.md"],
      },
      {
        sha: "b1e4c7a",
        repoPath: "/Users/alice/work/infra-charts",
        message: "chore(tempo): bump receiver to v2.4",
        authorType: "human",
        authorName: "Alice",
        timestamp: now - 1 * hour - 12 * minute,
        filesChanged: ["charts/tempo-values.yaml"],
      },
      {
        sha: "8d6f0a3",
        repoPath: "/Users/alice/work/backend-service",
        message: "test(tracing): integration with mock otel collector",
        authorType: "agent",
        authorPlatform: "opencode",
        authorName: "opencode",
        timestamp: now - 2 * hour,
        filesChanged: ["tests/tracing/otel.spec.ts"],
      },
    ],
    sessions: [
      {
        id: "sess-234-plan-1",
        requirementId: "REQ-234",
        platform: "claude-code",
        externalRef: "cc-7c2b9d",
        title: "梳理 OTLP 架构选项",
        status: "completed",
        participants: [
          { kind: "agent", name: "Claude Code", platform: "claude-code", role: "primary" },
          { kind: "human", name: "Alice", role: "reviewer" },
        ],
        startedAt: now - 3 * day,
        endedAt: now - 2 * day - 6 * hour,
        lastActivityAt: now - 2 * day - 6 * hour,
        toolCount: 3,
        messageCount: 14,
        durationMs: 18 * minute,
      },
      {
        id: "sess-234-plan-2",
        requirementId: "REQ-234",
        platform: "opencode",
        externalRef: "oc-92f0c4",
        title: "扫 codebase 找现有 instrumentation 入口",
        status: "completed",
        participants: [
          { kind: "agent", name: "opencode", platform: "opencode", role: "primary" },
        ],
        startedAt: now - 2 * day - 6 * hour,
        endedAt: now - 2 * day - 4 * hour,
        lastActivityAt: now - 2 * day - 4 * hour,
        toolCount: 8,
        messageCount: 28,
        durationMs: 45 * minute,
      },
      {
        id: "sess-234-do-1",
        requirementId: "REQ-234",
        platform: "opencode",
        externalRef: "oc-a3f9e1",
        title: "实现 otel middleware 并接入 router",
        status: "running",
        participants: [
          { kind: "agent", name: "opencode", platform: "opencode", role: "primary" },
          { kind: "human", name: "Alice", role: "reviewer" },
          { kind: "agent", name: "Claude Code", platform: "claude-code", role: "co-observer" },
        ],
        startedAt: now - 3 * hour,
        pausedAt: now - 2 * hour,
        resumedAt: now - 1 * hour,
        lastActivityAt: now - 18 * minute,
        toolCount: 6,
        messageCount: 52,
        durationMs: 1 * hour + 42 * minute,
      },
      {
        id: "sess-234-do-2",
        requirementId: "REQ-234",
        platform: "agno",
        externalRef: "agno-sess-302",
        title: "team: pr-review-team 实时 review 当前 diff",
        status: "running",
        participants: [
          { kind: "agent", name: "pr-review-team", platform: "agno", role: "primary" },
          { kind: "agent", name: "diff-fetcher", platform: "agno", role: "team-member" },
          { kind: "agent", name: "summarizer", platform: "agno", role: "team-member" },
          { kind: "human", name: "Alice", role: "owner" },
        ],
        startedAt: now - 22 * minute,
        lastActivityAt: now - 22 * minute,
        toolCount: 3,
        messageCount: 16,
        durationMs: 22 * minute,
      },
      {
        id: "sess-234-do-3",
        requirementId: "REQ-234",
        platform: "claude-code",
        externalRef: "cc-4e8b73",
        title: "写 sampling strategy rationale",
        status: "completed",
        participants: [
          { kind: "agent", name: "Claude Code", platform: "claude-code", role: "primary" },
        ],
        startedAt: now - 7 * hour,
        endedAt: now - 6 * hour,
        lastActivityAt: now - 6 * hour,
        toolCount: 2,
        messageCount: 8,
        durationMs: 12 * minute,
      },
    ],
  },

  // ---------------------------------------------------------------- REQ-198
  {
    id: "REQ-198",
    title: "Q4 financial report (Notion → markdown)",
    description:
      "从 Notion 'Q4 metrics' DB 抽取 47 条记录，跑异常检测，生成 markdown 报告（含 overview / anomalies / recommendations 三段）。",
    status: "delivered",
    createdAt: now - 14 * day,
    updatedAt: now - 2 * day,
    assignees: [
      { kind: "human", name: "Bob", avatar: "B" },
      { kind: "agent", name: "report-pipeline", platform: "agno" },
    ],
    repos: ["/Users/bob/work/notion-exporter"],
    currentStage: "deliver",
    activities: [
      {
        id: "act-198-1",
        kind: "stage-transition",
        requirementId: "REQ-198",
        at: now - 14 * day,
        fromStage: null,
        toStage: "plan",
        authorType: "human",
        authorName: "Bob",
        reason: "启动",
      },
      {
        id: "act-198-2",
        kind: "stage-transition",
        requirementId: "REQ-198",
        at: now - 13 * day,
        fromStage: "plan",
        toStage: "do",
        authorType: "agent",
        authorName: "report-pipeline",
        authorPlatform: "agno",
        reason: "调研完成，方案已选",
        sessionRef: "sess-198-do-1",
      },
      {
        id: "act-198-3",
        kind: "agent-note",
        requirementId: "REQ-198",
        at: now - 5 * day,
        authorType: "agent",
        authorName: "report-pipeline",
        authorPlatform: "agno",
        content: "报告初版已生成，47 条记录覆盖完整，3 处异常已标出。",
        sessionRef: "sess-198-do-1",
      },
      {
        id: "act-198-4",
        kind: "stage-transition",
        requirementId: "REQ-198",
        at: now - 5 * day,
        fromStage: "do",
        toStage: "check",
        authorType: "agent",
        authorName: "report-pipeline",
        authorPlatform: "agno",
        reason: "do 阶段产出完成",
      },
      {
        id: "act-198-5",
        kind: "stage-transition",
        requirementId: "REQ-198",
        at: now - 3 * day,
        fromStage: "check",
        toStage: "deliver",
        authorType: "human",
        authorName: "Bob",
        reason: "check 通过，进入交付",
      },
    ],
    documents: [
      {
        filePath: "docs/01-clarification.md",
        title: "需求澄清 · Q4 报告口径与受众",
        excerpt:
          "受众：CFO + 业务线负责人。口径：与 Notion 财务 DB 字段一一对应，不做二次加工。异常检测口径与现有 BI 工具对齐。",
        kind: "clarification",
        lastEditedBy: "human",
        lastEditedByName: "Bob",
        lastEditedAt: now - 14 * day,
        sizeBytes: 3_800,
        lineCount: 72,
      },
      {
        filePath: "docs/02-research-anomaly-methods.md",
        title: "调研 · 异常检测方法选型",
        excerpt:
          "对比 IQR / z-score / isolation forest；推荐 IQR + 阈值业务可解释。isolation forest 留作后续版本。",
        kind: "research",
        lastEditedBy: "claude-code",
        lastEditedByName: "Claude Code",
        lastEditedAt: now - 13 * day,
        sizeBytes: 6_400,
        lineCount: 168,
      },
      {
        filePath: "docs/03-final-report.md",
        title: "Q4 财务报告（最终交付）",
        excerpt:
          "47 条记录、3 处异常（conversion_rate 异常下探、APAC 营收高于均值 22%、marketing 投放 ROI 跌出预期）。",
        kind: "report",
        lastEditedBy: "claude-code",
        lastEditedByName: "Claude Code",
        lastEditedAt: now - 2 * day,
        sizeBytes: 18_700,
        lineCount: 482,
      },
      {
        filePath: "docs/04-executive-summary.md",
        title: "执行摘要（给 CFO 一页纸）",
        excerpt:
          "Q4 整体营收 +8.3%，但 marketing 投放 ROI 跌出预期；建议重新审视渠道分配。",
        kind: "report",
        lastEditedBy: "human",
        lastEditedByName: "Bob",
        lastEditedAt: now - 2 * day - 2 * hour,
        sizeBytes: 4_200,
        lineCount: 96,
      },
    ],
    branches: [
      {
        repoPath: "/Users/bob/work/notion-exporter",
        name: "req/REQ-198/main",
        lastCommitSha: short("c9a0d3b2e1f4"),
        aheadBy: 18,
        behindBy: 0,
        authorType: "human",
        authorName: "Bob",
        updatedAt: now - 2 * day,
        externalUrl: "https://git.internal/notion-exporter/-/tree/req/REQ-198/main",
      },
    ],
    mrs: [
      {
        repoPath: "/Users/bob/work/notion-exporter",
        iid: 87,
        title: "feat: Q4 report pipeline + markdown export",
        status: "merged",
        branch: "req/REQ-198/main",
        targetBranch: "main",
        authorType: "human",
        authorName: "Bob",
        externalUrl: "https://git.internal/notion-exporter/-/merge_requests/87",
        updatedAt: now - 2 * day,
      },
    ],
    commits: [
      {
        sha: "c9a0d3b",
        repoPath: "/Users/bob/work/notion-exporter",
        message: "docs: finalize Q4 summary",
        authorType: "human",
        authorName: "Bob",
        timestamp: now - 2 * day,
        filesChanged: ["reports/q4-2026-summary.md"],
      },
      {
        sha: "f4b1e72",
        repoPath: "/Users/bob/work/notion-exporter",
        message: "polish: tighten recommendation section",
        authorType: "agent",
        authorPlatform: "claude-code",
        authorName: "Claude Code",
        timestamp: now - 3 * day,
        filesChanged: ["reports/q4-2026.md"],
      },
    ],
    sessions: [
      {
        id: "sess-198-do-1",
        requirementId: "REQ-198",
        platform: "agno",
        externalRef: "agno-sess-118",
        title: "team: report-pipeline 拉 Notion 数据 + 出报告",
        status: "completed",
        participants: [
          { kind: "agent", name: "report-pipeline", platform: "agno", role: "primary" },
          { kind: "agent", name: "data-collector", platform: "agno", role: "team-member" },
          { kind: "agent", name: "analyst", platform: "agno", role: "team-member" },
          { kind: "human", name: "Bob", role: "owner" },
        ],
        startedAt: now - 13 * day,
        endedAt: now - 5 * day,
        lastActivityAt: now - 5 * day,
        toolCount: 24,
        messageCount: 86,
        durationMs: 6 * hour,
      },
      {
        id: "sess-198-check-1",
        requirementId: "REQ-198",
        platform: "claude-code",
        externalRef: "cc-f4b1e7",
        title: "polish recommendations section",
        status: "completed",
        participants: [
          { kind: "agent", name: "Claude Code", platform: "claude-code", role: "primary" },
          { kind: "human", name: "Bob", role: "reviewer" },
        ],
        startedAt: now - 3 * day,
        endedAt: now - 3 * day + 30 * minute,
        lastActivityAt: now - 3 * day,
        toolCount: 4,
        messageCount: 18,
        durationMs: 25 * minute,
      },
    ],
  },

  // ---------------------------------------------------------------- REQ-205
  {
    id: "REQ-205",
    title: "i18n strings audit (zh-CN ↔ en-US)",
    description:
      "扫所有前端仓库找出 zh-CN / en-US 不一致 / 缺失翻译 / 过期键。需要人工评审几个术语翻译取舍。",
    status: "paused",
    createdAt: now - 7 * day,
    updatedAt: now - 38 * minute,
    assignees: [
      { kind: "human", name: "Carol", avatar: "C" },
      { kind: "agent", name: "i18n-auditor", platform: "opencode" },
    ],
    repos: [
      "/Users/carol/work/web-app",
      "/Users/carol/work/admin-portal",
    ],
    currentStage: "check",
    activities: [
      {
        id: "act-205-1",
        kind: "stage-transition",
        requirementId: "REQ-205",
        at: now - 7 * day,
        fromStage: null,
        toStage: "plan",
        authorType: "human",
        authorName: "Carol",
        reason: "启动",
      },
      {
        id: "act-205-2",
        kind: "stage-transition",
        requirementId: "REQ-205",
        at: now - 3 * day,
        fromStage: "plan",
        toStage: "check",
        authorType: "human",
        authorName: "Carol",
        reason: "do 阶段产出已合并到 main",
      },
      {
        id: "act-205-3",
        kind: "comment",
        requirementId: "REQ-205",
        at: now - 38 * minute,
        authorType: "agent",
        authorName: "i18n-auditor",
        authorPlatform: "opencode",
        content: "47 处发现已记录。5 处术语翻译歧义待 @Carol 拍板，否则 check 阶段继续不下去。",
        sessionRef: "sess-205-check-1",
      },
    ],
    documents: [
      {
        filePath: "docs/01-clarification.md",
        title: "需求澄清 · i18n 字符串范围与歧义术语",
        excerpt:
          "仅扫 zh-CN / en-US 双语；术语翻译歧义点单列（“draft / 草稿”、“saved / 已保存”）；由 Carol 最终拍板。",
        kind: "clarification",
        lastEditedBy: "human",
        lastEditedByName: "Carol",
        lastEditedAt: now - 7 * day,
        sizeBytes: 2_200,
        lineCount: 58,
      },
      {
        filePath: "docs/02-audit-report.md",
        title: "审计报告 · 47 处不一致 / 缺失 / 过期",
        excerpt:
          "缺失：12 处 en-US 翻译完全为空；不一致：23 处同 key 翻译口径不同；过期：12 处引用的 key 已不在代码中使用。",
        kind: "report",
        lastEditedBy: "opencode",
        lastEditedByName: "i18n-auditor",
        lastEditedAt: now - 38 * minute,
        sizeBytes: 9_400,
        lineCount: 224,
      },
      {
        filePath: "docs/03-pending-decisions.md",
        title: "待决策 · 5 处术语翻译取舍",
        excerpt:
          "agent 已给出候选翻译 + 理由，待 Carol 评审。等不超 1 天，否则 check 阶段继续不下去。",
        kind: "other",
        lastEditedBy: "opencode",
        lastEditedByName: "i18n-auditor",
        lastEditedAt: now - 1 * day,
        sizeBytes: 1_900,
        lineCount: 44,
      },
    ],
    branches: [
      {
        repoPath: "/Users/carol/work/web-app",
        name: "req/REQ-205/i18n-audit",
        lastCommitSha: short("2a8c4f1b9e07"),
        aheadBy: 6,
        behindBy: 2,
        authorType: "agent",
        authorPlatform: "opencode",
        authorName: "i18n-auditor",
        updatedAt: now - 38 * minute,
        externalUrl: "https://git.internal/web-app/-/tree/req/REQ-205/i18n-audit",
      },
    ],
    mrs: [],
    commits: [
      {
        sha: "2a8c4f1",
        repoPath: "/Users/carol/work/web-app",
        message: "docs: i18n audit report (47 findings, 12 missing en-US)",
        authorType: "agent",
        authorPlatform: "opencode",
        authorName: "i18n-auditor",
        timestamp: now - 38 * minute,
        filesChanged: ["docs/02-audit-report.md"],
      },
    ],
    sessions: [
      {
        id: "sess-205-check-1",
        requirementId: "REQ-205",
        platform: "opencode",
        externalRef: "oc-2a8c4f",
        title: "扫 zh-CN ↔ en-US 不一致 + 写 audit 报告",
        status: "ask_user",
        participants: [
          { kind: "agent", name: "opencode", platform: "opencode", role: "primary" },
          { kind: "human", name: "Carol", role: "owner" },
        ],
        startedAt: now - 3 * day,
        pausedAt: now - 38 * minute,
        lastActivityAt: now - 38 * minute,
        toolCount: 11,
        messageCount: 47,
        durationMs: 4 * hour,
      },
      {
        id: "sess-205-check-2",
        requirementId: "REQ-205",
        platform: "claude-code",
        externalRef: "cc-31d9af",
        title: "草拟术语翻译候选",
        status: "ask_user",
        participants: [
          { kind: "agent", name: "Claude Code", platform: "claude-code", role: "primary" },
          { kind: "human", name: "Carol", role: "owner" },
        ],
        startedAt: now - 2 * day,
        pausedAt: now - 1 * day,
        lastActivityAt: now - 1 * day,
        toolCount: 2,
        messageCount: 12,
        durationMs: 8 * minute,
      },
    ],
  },
];

// ============================================================================
// DEMO FLOW —— 一键创建走完 plan → do → check → fix → check → deliver
// ============================================================================
//
// 7 步用户手动触发，每步把对应的 session / activity / doc / git 信息追加到 req。
// 时间锚点 T0 = req.createdAt，所有 step 共享一个时间轴。
// ============================================================================

export const DEMO_STEPS = [
  { id: 1, key: "create", label: "新建需求", icon: "plus" },
  { id: 2, key: "plan", label: "plan agent 分析", icon: "plan" },
  { id: 3, key: "build", label: "build agent 实施", icon: "build" },
  { id: 4, key: "validate", label: "validation 验证", icon: "check" },
  { id: 5, key: "fix", label: "build 修复", icon: "wrench" },
  { id: 6, key: "revalidate", label: "复验", icon: "check" },
  { id: 7, key: "deploy", label: "deploy 部署", icon: "rocket" },
] as const;

export type DemoStepId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

function actId(id: string, label: string): string {
  return `act-${id}-${label}`;
}

function sessIdFn(id: string, label: string): string {
  return `sess-${id}-${label}`;
}

export function createEmptyDemoRequirement(seq: number): Requirement {
  const id = `REQ-${300 + seq}`;
  const createdAt = Date.now();
  return {
    id,
    title: "用户登录与会话管理",
    description:
      "支持邮箱 / 手机号双登录方式；JWT 刷新；跨设备会话同步。要求：刷新令牌轮换无 race；多端踢出会话列表同步生效。",
    status: "active",
    createdAt,
    updatedAt: createdAt,
    assignees: [
      { kind: "human", name: "Alice", avatar: "A" },
      { kind: "agent", name: "plan-agent", platform: "agno" },
      { kind: "agent", name: "build-agent", platform: "claude-code" },
      { kind: "agent", name: "validation-agent", platform: "opencode" },
      { kind: "agent", name: "deploy-agent", platform: "codex" },
    ],
    repos: [
      "/Users/alice/work/backend-service",
      "/Users/alice/work/web-app",
    ],
    currentStage: "plan",
    activities: [
      {
        id: actId(id, "stage-init"),
        kind: "stage-transition",
        requirementId: id,
        at: createdAt,
        fromStage: null,
        toStage: "plan",
        authorType: "human",
        authorName: "Alice",
        reason: "需求已澄清，启动 plan 阶段",
      },
      {
        id: actId(id, "alice-create"),
        kind: "comment",
        requirementId: id,
        at: createdAt + 5 * minute,
        authorType: "human",
        authorName: "Alice",
        content: "新建需求，待 plan agent 分析。",
      },
    ],
    documents: [],
    branches: [],
    mrs: [],
    commits: [],
    sessions: [],
  };
}

export function applyDemoStep(req: Requirement, step: DemoStepId): Requirement {
  switch (step) {
    case 1:
      return req;
    case 2:
      return applyPlanStep(req);
    case 3:
      return applyBuildStep(req);
    case 4:
      return applyValidateStep(req);
    case 5:
      return applyFixStep(req);
    case 6:
      return applyRevalidateStep(req);
    case 7:
      return applyDeployStep(req);
  }
}

// ---- step 2: plan agent 分析 ----
function applyPlanStep(req: Requirement): Requirement {
  const id = req.id;
  const T0 = req.createdAt;
  const planEnd = T0 + 90 * minute;

  return {
    ...req,
    updatedAt: planEnd,
    sessions: [
      ...req.sessions,
      {
        id: sessIdFn(id, "plan"),
        requirementId: id,
        platform: "agno",
        externalRef: "agno-sess-512",
        title: "调研 + 设计 + 用户故事",
        status: "completed",
        participants: [
          { kind: "agent", name: "plan-agent", platform: "agno", role: "primary" },
          { kind: "human", name: "Alice", role: "owner" },
        ],
        startedAt: T0 + 30 * minute,
        endedAt: planEnd,
        lastActivityAt: planEnd,
        toolCount: 6,
        messageCount: 18,
        durationMs: 60 * minute,
      },
    ],
    documents: [
      ...req.documents,
      {
        filePath: "docs/01-research-auth-options.md",
        title: "调研 · 登录与 token 方案对比",
        excerpt:
          "对比 session-cookie vs JWT + refresh 两条路径。推荐 JWT：跨端友好，rotation refresh 解决长会话安全。",
        kind: "research",
        stage: "plan",
        lastEditedBy: "agno",
        lastEditedByName: "plan-agent",
        lastEditedAt: planEnd - 20 * minute,
        sizeBytes: 8_400,
        lineCount: 218,
      },
      {
        filePath: "docs/02-design-auth-flow.md",
        title: "方案 · JWT + 短 access + 旋转 refresh",
        excerpt:
          "access TTL 15min，refresh TTL 30d；refresh rotation 单飞 (single-flight)；多端会话踢出走 SSE 通知。",
        kind: "design",
        stage: "plan",
        lastEditedBy: "agno",
        lastEditedByName: "plan-agent",
        lastEditedAt: planEnd - 5 * minute,
        sizeBytes: 12_800,
        lineCount: 332,
      },
      {
        filePath: "docs/03-user-stories.md",
        title: "用户故事 · 登录与会话管理",
        excerpt:
          "6 个 story：邮箱登录 / 手机号登录 / refresh / 跨端踢出 / 退出 / 设备管理。AC 已列。",
        kind: "spec",
        stage: "plan",
        lastEditedBy: "agno",
        lastEditedByName: "plan-agent",
        lastEditedAt: planEnd,
        sizeBytes: 6_200,
        lineCount: 168,
      },
    ],
    activities: [
      {
        id: actId(id, "plan-note"),
        kind: "agent-note",
        requirementId: id,
        at: planEnd,
        authorType: "agent",
        authorName: "plan-agent",
        authorPlatform: "agno",
        content:
          "调研 + 方案 + 用户故事 三份文档已产出。推荐方案：JWT + 短 access + 旋转 refresh。",
        sessionRef: sessIdFn(id, "plan"),
      },
      ...req.activities,
    ],
  };
}

// ---- step 3: build agent 实施 ----
function applyBuildStep(req: Requirement): Requirement {
  const id = req.id;
  const backendRepo = "/Users/alice/work/backend-service";
  const frontendRepo = "/Users/alice/work/web-app";
  const T0 = req.createdAt;
  const doStart = T0 + 3 * hour;
  const doEnd = T0 + 8 * hour;

  return {
    ...req,
    updatedAt: doEnd + 30 * minute,
    currentStage: "check",
    sessions: [
      ...req.sessions,
      {
        id: sessIdFn(id, "build-1"),
        requirementId: id,
        platform: "claude-code",
        externalRef: "cc-8f3a91",
        title: "实施：后端 login/refresh + 前端 login form",
        status: "completed",
        participants: [
          { kind: "agent", name: "build-agent", platform: "claude-code", role: "primary" },
          { kind: "human", name: "Alice", role: "reviewer" },
        ],
        startedAt: doStart,
        endedAt: doEnd,
        lastActivityAt: doEnd,
        toolCount: 12,
        messageCount: 42,
        durationMs: 5 * hour,
      },
    ],
    branches: [
      ...req.branches,
      {
        repoPath: frontendRepo,
        name: `req/${id}/feat/login-ui`,
        lastCommitSha: short("b91c4f8a2e30"),
        aheadBy: 2,
        behindBy: 0,
        authorType: "agent",
        authorPlatform: "claude-code",
        authorName: "build-agent",
        updatedAt: doEnd,
        externalUrl: `https://git.internal/web-app/-/tree/req/${id}/feat/login-ui`,
      },
      {
        repoPath: backendRepo,
        name: `req/${id}/feat/auth-backend`,
        lastCommitSha: short("5c1d9f4a8e72"),
        aheadBy: 3,
        behindBy: 0,
        authorType: "agent",
        authorPlatform: "claude-code",
        authorName: "build-agent",
        updatedAt: doEnd,
        externalUrl: `https://git.internal/backend-service/-/tree/req/${id}/feat/auth-backend`,
      },
    ],
    mrs: [
      ...req.mrs,
      {
        repoPath: frontendRepo,
        iid: 202,
        title: "feat(ui): login form + session sync across devices",
        status: "open",
        branch: `req/${id}/feat/login-ui`,
        targetBranch: "main",
        authorType: "agent",
        authorPlatform: "claude-code",
        authorName: "build-agent",
        externalUrl: `https://git.internal/web-app/-/merge_requests/202`,
        updatedAt: doEnd,
      },
      {
        repoPath: backendRepo,
        iid: 201,
        title: "feat(auth): login + refresh + logout endpoints",
        status: "open",
        branch: `req/${id}/feat/auth-backend`,
        targetBranch: "main",
        authorType: "agent",
        authorPlatform: "claude-code",
        authorName: "build-agent",
        externalUrl: `https://git.internal/backend-service/-/merge_requests/201`,
        updatedAt: doEnd,
      },
    ],
    commits: [
      ...req.commits,
      {
        sha: "2b8e6a1",
        repoPath: frontendRepo,
        message: "feat(ui): login form + session sync UI",
        authorType: "agent",
        authorPlatform: "claude-code",
        authorName: "build-agent",
        timestamp: doEnd - 45 * minute,
        filesChanged: ["src/views/Login.tsx", "src/hooks/use-session-sync.ts"],
      },
      {
        sha: "5c1d9f4",
        repoPath: backendRepo,
        message: "feat(auth): login + refresh + logout endpoints",
        authorType: "agent",
        authorPlatform: "claude-code",
        authorName: "build-agent",
        timestamp: doEnd - 30 * minute,
        filesChanged: ["src/auth/login.ts", "src/auth/refresh.ts", "src/auth/logout.ts"],
      },
      {
        sha: "8e3a720",
        repoPath: backendRepo,
        message: "test(auth): integration tests for login + refresh + logout",
        authorType: "agent",
        authorPlatform: "claude-code",
        authorName: "build-agent",
        timestamp: doEnd,
        filesChanged: ["tests/auth/integration.spec.ts", "tests/auth/rotation.spec.ts"],
      },
    ],
    activities: [
      {
        id: actId(id, "stage-do"),
        kind: "stage-transition",
        requirementId: id,
        at: T0 + 2 * hour + 30 * minute,
        fromStage: "plan",
        toStage: "do",
        authorType: "human",
        authorName: "Alice",
        reason: "方案已定稿，转 do 实施",
      },
      {
        id: actId(id, "build1-note"),
        kind: "agent-note",
        requirementId: id,
        at: doEnd,
        authorType: "agent",
        authorName: "build-agent",
        authorPlatform: "claude-code",
        content:
          "实施完成：后端 login/refresh/logout 3 接口 + 前端 login form + 跨端会话同步 UI；3 commits / 2 branches / 2 MRs。",
        sessionRef: sessIdFn(id, "build-1"),
      },
      {
        id: actId(id, "stage-check-1"),
        kind: "stage-transition",
        requirementId: id,
        at: doEnd + 30 * minute,
        fromStage: "do",
        toStage: "check",
        authorType: "human",
        authorName: "Alice",
        reason: "实施完成，启动验证",
      },
      ...req.activities,
    ],
  };
}

// ---- step 4: validation 验证（初验，发现 2 个问题）----
function applyValidateStep(req: Requirement): Requirement {
  const id = req.id;
  const T0 = req.createdAt;
  const check1Start = T0 + 1 * day + 2 * hour;
  const check1End = check1Start + 50 * minute;

  return {
    ...req,
    updatedAt: check1End + 5 * minute,
    currentStage: "do",
    sessions: [
      ...req.sessions,
      {
        id: sessIdFn(id, "validate-1"),
        requirementId: id,
        platform: "opencode",
        externalRef: "oc-9c2b7e",
        title: "初验：跑集成测试 + 边界用例",
        status: "completed",
        participants: [
          { kind: "agent", name: "validation-agent", platform: "opencode", role: "primary" },
          { kind: "human", name: "Alice", role: "owner" },
        ],
        startedAt: check1Start,
        endedAt: check1End,
        lastActivityAt: check1End,
        toolCount: 4,
        messageCount: 16,
        durationMs: 50 * minute,
      },
    ],
    documents: [
      ...req.documents,
      {
        filePath: "docs/04-validation-report-v1.md",
        title: "验证报告 v1 · 2 处问题",
        excerpt:
          "集成测试 24 用例 23 通过 / 1 偶发；边界用例 12 通过 / 1 偶发。两处问题：① refresh rotation race ② 401 重定向丢 query。",
        kind: "report",
        stage: "check",
        lastEditedBy: "opencode",
        lastEditedByName: "validation-agent",
        lastEditedAt: check1End,
        sizeBytes: 9_600,
        lineCount: 248,
      },
    ],
    activities: [
      {
        id: actId(id, "validate-issue-comment"),
        kind: "comment",
        requirementId: id,
        at: check1End - 5 * minute,
        authorType: "agent",
        authorName: "validation-agent",
        authorPlatform: "opencode",
        content:
          "@Alice 发现 2 个问题：① refresh token 在并发场景下偶发 rotation race；② 401 重定向丢失 query 参数。建议 build 修复后复验。",
        sessionRef: sessIdFn(id, "validate-1"),
      },
      {
        id: actId(id, "validate1-note"),
        kind: "agent-note",
        requirementId: id,
        at: check1End,
        authorType: "agent",
        authorName: "validation-agent",
        authorPlatform: "opencode",
        content: "初验完成，详见 docs/04-validation-report-v1.md（2 处问题需要修复）。",
        sessionRef: sessIdFn(id, "validate-1"),
      },
      {
        id: actId(id, "stage-fix"),
        kind: "stage-transition",
        requirementId: id,
        at: check1End + 5 * minute,
        fromStage: "check",
        toStage: "do",
        authorType: "human",
        authorName: "Alice",
        reason: "初验发现 2 问题，转回 do 修复",
      },
      ...req.activities,
    ],
  };
}

// ---- step 5: build 修复 ----
function applyFixStep(req: Requirement): Requirement {
  const id = req.id;
  const backendRepo = "/Users/alice/work/backend-service";
  const frontendRepo = "/Users/alice/work/web-app";
  const T0 = req.createdAt;
  const fixStart = T0 + 1 * day + 3 * hour;
  const fixEnd = T0 + 1 * day + 5 * hour + 30 * minute;

  return {
    ...req,
    updatedAt: fixEnd,
    currentStage: "check",
    sessions: [
      ...req.sessions,
      {
        id: sessIdFn(id, "build-2"),
        requirementId: id,
        platform: "claude-code",
        externalRef: "cc-7d1e3a",
        title: "修复：refresh token rotation race + 401 重定向",
        status: "completed",
        participants: [
          { kind: "agent", name: "build-agent", platform: "claude-code", role: "primary" },
          { kind: "human", name: "Alice", role: "reviewer" },
        ],
        startedAt: fixStart,
        endedAt: fixEnd,
        lastActivityAt: fixEnd,
        toolCount: 7,
        messageCount: 26,
        durationMs: 2 * hour + 30 * minute,
      },
    ],
    commits: [
      ...req.commits,
      {
        sha: "b91c4f8",
        repoPath: frontendRepo,
        message: "fix(ui): preserve query on 401 redirect",
        authorType: "agent",
        authorPlatform: "claude-code",
        authorName: "build-agent",
        timestamp: fixEnd - 30 * minute,
        filesChanged: ["src/lib/auth-redirect.ts"],
      },
      {
        sha: "3a7f2c1",
        repoPath: backendRepo,
        message: "fix(auth): single-flight refresh token rotation",
        authorType: "agent",
        authorPlatform: "claude-code",
        authorName: "build-agent",
        timestamp: fixEnd,
        filesChanged: ["src/auth/refresh.ts", "src/auth/rotation.ts"],
      },
    ],
    activities: [
      {
        id: actId(id, "build-fix-note"),
        kind: "agent-note",
        requirementId: id,
        at: fixEnd,
        authorType: "agent",
        authorName: "build-agent",
        authorPlatform: "claude-code",
        content:
          "修复完成：refresh token rotation race 改用 single-flight；401 重定向改为保留 query 参数。",
        sessionRef: sessIdFn(id, "build-2"),
      },
      {
        id: actId(id, "stage-check-2"),
        kind: "stage-transition",
        requirementId: id,
        at: fixEnd + 10 * minute,
        fromStage: "do",
        toStage: "check",
        authorType: "human",
        authorName: "Alice",
        reason: "修复完成，启动复验",
      },
      ...req.activities,
    ],
  };
}

// ---- step 6: 同一 session 复验 ----
function applyRevalidateStep(req: Requirement): Requirement {
  const id = req.id;
  const T0 = req.createdAt;
  const validateId = sessIdFn(id, "validate-1");
  const check2Start = T0 + 2 * day + 3 * hour;
  const check2End = check2Start + 35 * minute;

  const updatedSessions = req.sessions.map((s) => {
    if (s.id !== validateId) return s;
    return {
      ...s,
      resumedAt: check2Start,
      endedAt: check2End,
      lastActivityAt: check2End,
      messageCount: s.messageCount + 8,
      durationMs: (s.durationMs ?? 0) + 35 * minute,
    };
  });

  return {
    ...req,
    updatedAt: check2End + 30 * minute,
    currentStage: "deliver",
    status: "delivered",
    sessions: updatedSessions,
    documents: [
      ...req.documents,
      {
        filePath: "docs/05-validation-report-v2.md",
        title: "验证报告 v2 · 复验通过",
        excerpt:
          "原 2 处问题已修复；新增 4 个边界用例覆盖。回归 + 边界共 36 用例，全通过。check 通过。",
        kind: "report",
        stage: "check",
        lastEditedBy: "opencode",
        lastEditedByName: "validation-agent",
        lastEditedAt: check2End,
        sizeBytes: 11_200,
        lineCount: 286,
      },
    ],
    mrs: req.mrs.map((m) => ({ ...m, status: "merged" as const })),
    activities: [
      {
        id: actId(id, "validate-pass"),
        kind: "agent-note",
        requirementId: id,
        at: check2End,
        authorType: "agent",
        authorName: "validation-agent",
        authorPlatform: "opencode",
        content:
          "复验完成。原 2 个问题（refresh token rotation race / 401 重定向丢 query）已修复，本次回归 0 问题，check 通过。",
        sessionRef: validateId,
      },
      {
        id: actId(id, "stage-deliver"),
        kind: "stage-transition",
        requirementId: id,
        at: check2End + 30 * minute,
        fromStage: "check",
        toStage: "deliver",
        authorType: "human",
        authorName: "Alice",
        reason: "复验通过，进入交付",
      },
      ...req.activities,
    ],
  };
}

// ---- step 7: deploy 部署 ----
function applyDeployStep(req: Requirement): Requirement {
  const id = req.id;
  const T0 = req.createdAt;
  const deployStart = T0 + 2 * day + 4 * hour;
  const deployEnd = T0 + 2 * day + 6 * hour + 30 * minute;

  return {
    ...req,
    updatedAt: deployEnd,
    sessions: [
      ...req.sessions,
      {
        id: sessIdFn(id, "deploy"),
        requirementId: id,
        platform: "codex",
        externalRef: "cdx-deploy-44",
        title: "部署：5 个微服务滚动升级 + 24h 灰度监控",
        status: "completed",
        participants: [
          { kind: "agent", name: "deploy-agent", platform: "codex", role: "primary" },
          { kind: "human", name: "Alice", role: "reviewer" },
        ],
        startedAt: deployStart,
        endedAt: deployEnd,
        lastActivityAt: deployEnd,
        toolCount: 9,
        messageCount: 22,
        durationMs: 2 * hour + 30 * minute,
      },
    ],
    documents: [
      ...req.documents,
      {
        filePath: "docs/06-online-validation-report.md",
        title: "线上验证报告 · 24h 灰度观察",
        excerpt:
          "灰度期间：登录成功率 99.94%；refresh 失败率 0.02%（低于基线 0.05%）；跨端踢出 SSE 通知到达率 100%。",
        kind: "report",
        stage: "deliver",
        lastEditedBy: "codex",
        lastEditedByName: "deploy-agent",
        lastEditedAt: deployEnd,
        sizeBytes: 7_800,
        lineCount: 198,
      },
    ],
    activities: [
      {
        id: actId(id, "deploy-note"),
        kind: "agent-note",
        requirementId: id,
        at: deployEnd,
        authorType: "agent",
        authorName: "deploy-agent",
        authorPlatform: "codex",
        content:
          "线上部署完成，5 个微服务滚动升级完成；24h 灰度观察在线验证报告（见 artifacts）。",
        sessionRef: sessIdFn(id, "deploy"),
      },
      ...req.activities,
    ],
  };
}

// 派生每个 demo step 在 req 上的完成状态（用于按钮 enable/disable）
export function demoStepStates(req: Requirement): Record<DemoStepId, "pending" | "active" | "done"> {
  const sessions = req.sessions.map((s) => s.id);
  const transitions = req.activities.filter((a) => a.kind === "stage-transition");

  const hasStageInit = transitions.some((a) => a.kind === "stage-transition" && a.fromStage === null);
  const hasPlanSession = sessions.some((id) => id.endsWith("-plan"));
  const hasBuild1 = sessions.some((id) => id.endsWith("-build-1"));
  const hasValidate1 = sessions.some((id) => id.endsWith("-validate-1"));
  const hasBuild2 = sessions.some((id) => id.endsWith("-build-2"));
  const hasDeploy = sessions.some((id) => id.endsWith("-deploy"));

  // plan→do 后再 do→check 才算 step 3 完成
  const planToDoAt = transitions.find((a) => a.kind === "stage-transition" && a.fromStage === "plan" && a.toStage === "do")?.at ?? 0;
  const doToCheckCount = transitions.filter(
    (a) => a.kind === "stage-transition" && a.fromStage === "do" && a.toStage === "check" && a.at >= planToDoAt
  ).length;
  const checkToDoCount = transitions.filter(
    (a) => a.kind === "stage-transition" && a.fromStage === "check" && a.toStage === "do"
  ).length;

  const validate1 = req.sessions.find((s) => s.id.endsWith("-validate-1"));
  const validateResumed = validate1?.resumedAt != null;

  const s1 = hasStageInit;
  const s2 = s1 && hasPlanSession;
  const s3 = s2 && hasBuild1 && doToCheckCount >= 1;
  const s4 = s3 && hasValidate1 && checkToDoCount >= 1;
  const s5 = s4 && hasBuild2;
  const s6 = s5 && validateResumed;
  const s7 = s6 && hasDeploy;

  const mk = (done: boolean, prev: boolean): "pending" | "active" | "done" =>
    done ? "done" : prev ? "active" : "pending";

  return {
    1: mk(s1, true),
    2: mk(s2, s1),
    3: mk(s3, s2),
    4: mk(s4, s3),
    5: mk(s5, s4),
    6: mk(s6, s5),
    7: mk(s7, s6),
  };
}