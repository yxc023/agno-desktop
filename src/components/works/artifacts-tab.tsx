import { useEffect, useState } from "react";
import {
  FileText,
  ClipboardList,
  FlaskConical,
  ListChecks,
  GitMerge,
  ScrollText,
  AlertTriangle,
  FileQuestion,
  BookOpen,
  X,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { DocKind, Document as Doc, Requirement } from "./types";

const DOC_META: Record<
  DocKind,
  { Icon: React.ComponentType<{ className?: string }>; label: string; color: string }
> = {
  clarification: { Icon: ClipboardList, label: "clarification", color: "text-info" },
  research: { Icon: FlaskConical, label: "research", color: "text-accent" },
  spec: { Icon: ScrollText, label: "spec", color: "text-info" },
  design: { Icon: BookOpen, label: "design", color: "text-accent" },
  adr: { Icon: GitMerge, label: "adr", color: "text-warning" },
  "test-plan": { Icon: ListChecks, label: "test-plan", color: "text-success" },
  risk: { Icon: AlertTriangle, label: "risk", color: "text-destructive" },
  report: { Icon: FileText, label: "report", color: "text-success" },
  other: { Icon: FileQuestion, label: "doc", color: "text-muted-foreground" },
};

function formatSize(b?: number): string {
  if (!b) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

interface ArtifactsTabProps {
  requirement: Requirement;
}

export function ArtifactsTab({ requirement }: ArtifactsTabProps) {
  const docs = [...requirement.documents].sort((a, b) => b.lastEditedAt - a.lastEditedAt);
  const [preview, setPreview] = useState<Doc | null>(null);

  const stats: Record<string, number> = {};
  for (const d of docs) stats[d.kind] = (stats[d.kind] ?? 0) + 1;

  return (
    <>
      <ScrollArea className="h-full">
        <div className="space-y-3 px-5 py-4">
          {docs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {(Object.entries(stats) as Array<[DocKind, number]>).map(([k, n]) => {
                const meta = DOC_META[k];
                return (
                  <span
                    key={k}
                    className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/85"
                  >
                    <meta.Icon className={cn("h-2.5 w-2.5", meta.color)} />
                    <span className="text-foreground/85">{meta.label}</span>
                    <span className="text-muted-foreground/55">×{n}</span>
                  </span>
                );
              })}
              <span className="ml-auto font-mono text-[10px] text-muted-foreground/55">
                共 {docs.length} 篇
              </span>
            </div>
          )}

          <div className="overflow-hidden rounded-md border border-border/60">
            {docs.map((d, i) => (
              <DocRow
                key={d.filePath}
                doc={d}
                divider={i < docs.length - 1}
                selected={preview?.filePath === d.filePath}
                onPreview={() => setPreview(d)}
              />
            ))}
          </div>

          {docs.length === 0 && (
            <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-3 py-8 text-center font-mono text-[10.5px] text-muted-foreground/50">
              该需求暂无过程文档
            </div>
          )}
        </div>
      </ScrollArea>

      <DocumentPreviewPanel doc={preview} onClose={() => setPreview(null)} />
    </>
  );
}

function DocRow({
  doc,
  divider,
  selected,
  onPreview,
}: {
  doc: Doc;
  divider: boolean;
  selected: boolean;
  onPreview: () => void;
}) {
  const meta = DOC_META[doc.kind];
  const Icon = meta.Icon;
  return (
    <button
      type="button"
      onClick={onPreview}
      className={cn(
        "group flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors",
        selected
          ? "bg-sidebar-accent"
          : "hover:bg-sidebar-accent/40",
        divider && "border-b border-border/40"
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.color)} />
      <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/90">
        {doc.filePath}
      </span>
      <Badge variant="outline" className="shrink-0 font-mono text-[9.5px] tracking-wider">
        {meta.label}
      </Badge>
      <span className="hidden w-20 text-right font-mono text-[10px] text-muted-foreground/55 sm:inline">
        {formatSize(doc.sizeBytes)}
      </span>
      <span className="hidden w-16 text-right font-mono text-[10px] text-muted-foreground/55 sm:inline">
        {doc.lineCount ?? "—"} 行
      </span>
      <span className="w-20 text-right font-mono text-[10px] text-muted-foreground/55">
        {formatRelativeTime(doc.lastEditedAt)}
      </span>
    </button>
  );
}

function DocumentPreviewPanel({
  doc,
  onClose,
}: {
  doc: Doc | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, onClose]);

  if (!doc) return null;
  const meta = DOC_META[doc.kind];
  const Icon = meta.Icon;
  const lines = buildMockBody(doc);

  return (
    <aside
      className="fixed inset-y-0 right-0 z-50 flex w-[min(560px,80vw)] flex-col border-l border-border bg-background shadow-2xl animate-slide-in-right"
      role="dialog"
      aria-modal="true"
      aria-label="文档预览"
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <span
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/30",
            meta.color
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">
              {doc.title}
            </h2>
            <Badge variant="outline" className="shrink-0 font-mono text-[9.5px] tracking-wider">
              {meta.label}
            </Badge>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground/70">
            <span className="truncate">{doc.filePath}</span>
            <span className="text-muted-foreground/30">·</span>
            <span>{formatSize(doc.sizeBytes)}</span>
            <span className="text-muted-foreground/30">·</span>
            <span>{doc.lineCount ?? "—"} 行</span>
            <span className="text-muted-foreground/30">·</span>
            <span>{formatRelativeTime(doc.lastEditedAt)}</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-7 w-7"
          onClick={onClose}
          title="关闭 (Esc)"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <pre className="whitespace-pre-wrap px-5 py-4 font-mono text-[12px] leading-relaxed text-foreground/90">
          {lines}
        </pre>
      </ScrollArea>
    </aside>
  );
}

function buildMockBody(doc: Doc): string {
  const heading = `# ${doc.title}\n\n`;
  const meta = `> kind: ${doc.kind}${doc.stage ? `  ·  stage: ${doc.stage}` : ""}  ·  ${doc.lineCount ?? "?"} 行  ·  ${formatSize(doc.sizeBytes)}\n\n`;
  const intro = `${doc.excerpt}\n\n`;

  const sections: Record<DocKind, string[]> = {
    clarification: [
      "## 范围\n\n- in-scope: …\n- out-of-scope: …\n\n",
      "## 关键约束\n\n1. ……\n2. ……\n\n",
      "## 待澄清问题\n\n- [ ] ……\n- [ ] ……\n\n",
    ],
    research: [
      "## 候选方案\n\n1. **方案 A** — ……\n2. **方案 B** — ……\n3. **方案 C** — ……\n\n",
      "## 评估维度\n\n| 维度 | A | B | C |\n|---|---|---|---|\n| 性能 | … | … | … |\n| 复杂度 | … | … | … |\n| 维护成本 | … | … | … |\n\n",
      "## 结论\n\n推荐方案 B，理由：……\n\n",
    ],
    spec: [
      "## 目标\n\n……\n\n",
      "## 接口\n\n```\nPOST /api/v1/traces\n  body: { spans: Span[] }\n```\n\n",
      "## 行为\n\n1. ……\n2. ……\n\n",
    ],
    design: [
      "## 架构总览\n\n（架构图占位）\n\n",
      "## 模块拆分\n\n- **ingest** — ……\n- **processor** — ……\n- **sink** — ……\n\n",
      "## 数据流\n\n```\nclient → edge → backend → tempo\n```\n\n",
    ],
    adr: [
      "## Context\n\n……\n\n",
      "## Decision\n\n……\n\n",
      "## Consequences\n\n- 正面：……\n- 负面：……\n- 取舍：……\n\n",
    ],
    "test-plan": [
      "## 单元测试\n\n- ……\n- ……\n\n",
      "## 集成测试\n\n- ……\n\n",
      "## E2E\n\n- ……\n\n",
    ],
    risk: [
      "## 已识别风险\n\n| 风险 | 等级 | 缓解策略 |\n|---|---|---|\n| …… | 高 | …… |\n| …… | 中 | …… |\n\n",
    ],
    report: [
      "## 本阶段完成\n\n- ……\n- ……\n\n",
      "## 在进行中\n\n- ……\n\n",
      "## 阻塞 / 风险\n\n- ……\n\n",
      "## 下一阶段计划\n\n- ……\n\n",
    ],
    other: ["## 内容\n\n……\n\n"],
  };

  const tail =
    "## 修订记录\n\n| rev | author | date | note |\n|---|---|---|---|\n| r1 | … | … | 初稿 |\n";

  return heading + meta + intro + sections[doc.kind].join("") + tail;
}