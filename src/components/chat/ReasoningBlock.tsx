import { useState } from "react";
import { ChevronDown, Brain, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/markdown/Markdown";
import { useSettingsStore } from "@/stores/settings-store";

interface ReasoningBlockProps {
  text: string;
  steps?: Array<{
    title?: string;
    reasoning?: string;
    action?: string;
    result?: string;
  }>;
  streaming?: boolean;
}

export function ReasoningBlock({ text, steps, streaming }: ReasoningBlockProps) {
  const collapseReasoning = useSettingsStore((s) => s.collapseReasoning);
  const [manualOpen, setManualOpen] = useState(!collapseReasoning);
  const open = manualOpen;

  const hasSteps = steps && steps.length > 0;
  const preview = text.slice(0, 120);

  return (
    <div className="my-2 overflow-hidden rounded-md border border-accent/20 bg-accent/[0.03]">
      <button
        type="button"
        onClick={() => setManualOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] text-accent/90 transition-colors hover:bg-accent/[0.05]"
      >
        <Brain className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        <span className="font-medium">
          {streaming ? "thinking" : "思考过程"}
        </span>
        {streaming && (
          <Loader2 className="h-3 w-3 animate-spin text-accent/70" />
        )}
        {!open && text && (
          <span className="flex-1 truncate font-mono text-[10.5px] text-accent/60 font-normal">
            {preview + (text.length > 120 ? "…" : "")}
          </span>
        )}
        <ChevronDown
          className={cn(
            "ml-auto h-3 w-3 shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="space-y-2.5 border-t border-accent/15 px-3 py-2.5 text-[12px] text-foreground/85">
          {hasSteps && (
            <div className="space-y-2">
              {steps.map((s, i) => (
                <div key={i} className="flex gap-2.5">
                  <span className="shrink-0 pt-0.5 font-mono text-[10px] text-accent/60">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    {s.title && (
                      <div className="font-medium text-foreground">{s.title}</div>
                    )}
                    {s.action && (
                      <div className="italic text-accent/80">
                        <span className="text-accent">→</span> {s.action}
                      </div>
                    )}
                    {s.reasoning && (
                      <Markdown className="text-[11.5px] [&_p]:my-0.5 [&_code]:bg-accent/10 [&_code]:text-accent">
                        {s.reasoning}
                      </Markdown>
                    )}
                    {s.result && (
                      <div className="border-l-2 border-accent/20 pl-2 text-[11px] text-muted-foreground">
                        {s.result}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {text && (
            <Markdown className="text-[12px] text-foreground/90 [&_p]:my-1 [&_code]:bg-accent/10 [&_code]:text-accent">
              {text}
            </Markdown>
          )}
        </div>
      )}
    </div>
  );
}