import { useState, useCallback } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/utils";

interface Props {
  language?: string;
  value: string;
  className?: string;
}

export function CodeBlock({ language, value, className }: Props) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    const ok = await copyToClipboard(value);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [value]);

  return (
    <div
      className={cn(
        "group relative my-3 overflow-hidden rounded-lg border bg-[#0d1117] dark:bg-[#0d1117]",
        className
      )}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 bg-white/[0.02]">
        <span className="text-[11px] font-mono text-zinc-400 lowercase">
          {language || "text"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onCopy}
          className="h-6 w-6 text-zinc-400 hover:text-zinc-100 hover:bg-white/10"
        >
          {copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12.5px] leading-relaxed font-mono text-zinc-100">
        <code className={`language-${language || "text"}`}>{value}</code>
      </pre>
    </div>
  );
}