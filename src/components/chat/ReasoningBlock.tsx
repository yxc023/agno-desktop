import { useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
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
    <div className="my-2 rounded bg-muted/40 px-3 py-2 text-[11.5px] text-muted-foreground">
      <button
        type="button"
        onClick={() => setManualOpen(!open)}
        className="flex w-full items-center gap-2 text-left transition-opacity hover:opacity-80"
      >
        <span className="font-medium">
          {streaming ? "thinking" : "思考过程"}
        </span>
        {streaming && (
          <Loader2 className="h-3 w-3 animate-spin" />
        )}
        {!open && text && (
          <span className="flex-1 truncate font-mono text-[10.5px] opacity-70">
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
        <div className="mt-1.5 space-y-2.5 leading-relaxed">
          {hasSteps && (
            <div className="space-y-2">
              {steps.map((s, i) => (
                <div key={i} className="flex gap-2.5">
                  <span className="shrink-0 pt-0.5 font-mono text-[10px] opacity-60">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    {s.title && (
                      <div className="font-medium text-foreground/85">{s.title}</div>
                    )}
                    {s.action && (
                      <div className="italic opacity-80">
                        <span>→</span> {s.action}
                      </div>
                    )}
                    {s.reasoning && (
                      <Markdown className="text-[11.5px] [&_p]:my-0.5">
                        {s.reasoning}
                      </Markdown>
                    )}
                    {s.result && (
                      <div className="border-l-2 border-muted-foreground/20 pl-2 text-[11px] opacity-80">
                        {s.result}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {text && (
            <Markdown className="text-[11.5px] [&_p]:my-1">
              {text}
            </Markdown>
          )}
        </div>
      )}
    </div>
  );
}