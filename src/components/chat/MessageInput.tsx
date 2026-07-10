import { useEffect, useRef, useState } from "react";
import { Send, Paperclip, X, Square, Loader2, FileText, AlertTriangle, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { shouldSendOnEnter } from "@/lib/ime-composing";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { UserIdSetupDialog } from "@/components/common/UserIdSetupDialog";

export function MessageInput() {
  const sendMessage = useChatStore((s) => s.sendMessage);
  const cancelRun = useChatStore((s) => s.cancelRun);
  const runner = useChatStore((s) => s.runner);
  const isRunning = runner?.isRunning() ?? false;

  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [showUserIdSetup, setShowUserIdSetup] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // IME composition 状态：
  // - 中文 / 日文 / 韩文输入法在用户输入拼音 / 假名 / 谚文时会进入
  //   composition 状态，此时按 Enter 是"确认候选词"，不是"提交消息"。
  // - 用 ref 而不是 state 是因为 keydown 回调里要同步读到最新值，
  //   setState 的批处理会让 callback 里读到陈旧值。
  // - 在 handleKeyDown 里再叠加 e.nativeEvent.isComposing / keyCode===229
  //   三层判定（见 shouldSendOnEnter 的注释），覆盖老 Safari/iOS Gboard
  //   等边界情况。
  const composingRef = useRef(false);

  const userId = useSettingsStore((s) => s.userId);
  const userIdConfirmed = useSettingsStore((s) => s.userIdConfirmed);
  const needUserId = !userId.trim() || !userIdConfirmed;

  // 自适应高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 240) + "px";
    }
  }, [text]);

  async function handleSend() {
    if (needUserId) {
      setShowUserIdSetup(true);
      return;
    }
    if (!text.trim() || sending || isRunning) return;
    setSending(true);
    try {
      await sendMessage({
        text: text.trim(),
        files: files.length > 0 ? files : undefined,
      });
      setText("");
      setFiles([]);
    } catch (err) {
      console.error("sendMessage failed", err);
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (shouldSendOnEnter(e, composingRef)) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleCompositionStart() {
    composingRef.current = true;
  }

  function handleCompositionEnd() {
    composingRef.current = false;
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    setFiles((prev) => [...prev, ...list]);
    e.target.value = "";
  }

  return (
    <div className="border-t border-border bg-background/80 backdrop-blur px-4 py-3">
      <div className="max-w-3xl mx-auto">
        {needUserId && (
          <button
            onClick={() => setShowUserIdSetup(true)}
            className="mb-2 flex w-full items-center gap-2 rounded-md border border-warning/40 bg-warning/[0.04] px-3 py-2 text-left transition-colors hover:bg-warning/[0.08]"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
            <div className="flex-1 text-[12px] text-warning">
              还没有设置 user_id，点击设置后才能发送消息
            </div>
            <span className="font-mono text-[10.5px] text-warning">SETUP →</span>
          </button>
        )}

        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <FileChip
                key={i}
                file={f}
                onRemove={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        )}

        <div
          className={cn(
            "relative flex items-end gap-2 rounded-xl border bg-card shadow-sm transition-all",
            "focus-within:border-primary/40 focus-within:shadow-md",
            isRunning && "border-primary/30",
            needUserId && "opacity-70"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isRunning || needUserId}
            className="ml-1 mb-1 shrink-0"
            title="附加文件"
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder={
              isRunning
                ? "Agent 正在响应…"
                : needUserId
                ? "先设置 user_id 才能发送消息"
                : "发送消息 (Enter 发送, Shift+Enter 换行)"
            }
            rows={1}
            disabled={isRunning}
            className="flex-1 min-h-[36px] max-h-[240px] border-0 shadow-none focus-visible:ring-0 bg-transparent resize-none px-1 py-2 text-sm"
          />

          {isRunning ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => cancelRun()}
              className="mr-1 mb-1 shrink-0 text-destructive"
              title="停止生成"
            >
              <Square className="h-4 w-4 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              onClick={handleSend}
              disabled={!text.trim() || sending}
              className="mr-1 mb-1 shrink-0"
              title={needUserId ? "先设置 user_id" : "发送"}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between mt-1.5 px-1">
          <button
            onClick={() => setShowUserIdSetup(true)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground/80 hover:text-foreground"
          >
            <User className="h-2.5 w-2.5" />
            <span className="font-mono">
              user_id: {userId.trim() || "未设置"}
            </span>
          </button>
          <div className="text-[10px] text-muted-foreground">
            Enter 发送 · Shift+Enter 换行
          </div>
        </div>
      </div>

      <UserIdSetupDialog
        open={showUserIdSetup}
        onOpenChange={setShowUserIdSetup}
      />
    </div>
  );
}

function FileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  const sizeKb = (file.size / 1024).toFixed(1);
  return (
    <div className="flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs">
      <FileText className="h-3 w-3 text-muted-foreground" />
      <span className="font-medium truncate max-w-[150px]">{file.name}</span>
      <span className="text-muted-foreground">{sizeKb}KB</span>
      <button
        onClick={onRemove}
        className="ml-1 hover:bg-foreground/10 rounded-sm p-0.5"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}