import { useEffect, useRef, useState } from "react";
import { Send, Paperclip, X, Square, Loader2, FileText, AlertTriangle, User } from "lucide-react";
import { Button } from "../../ui/button";
import { Textarea } from "../../ui/input";
import { cn } from "../../lib/utils";
import { shouldSendOnEnter } from "../../lib/ime-composing";
import { useChatStore, useCurrentSessionMessages } from "../../stores/chat-store";
import { useActiveInstance } from "../../stores/instances-store";
import { useSessionsStore } from "../../stores/sessions-store";
import { AgentPicker } from "./AgentPicker";

export function MessageInput() {
  const sendMessage = useChatStore((s) => s.sendMessage);
  const cancelRun = useChatStore((s) => s.cancelRun);

  // Per-session streaming 状态 —— 之前直接读 `runner?.isRunning()` 是全局
  // 状态，导致切到其他 session 时输入框仍显示"Agent 正在响应…"。
  // 这里改为：自己 session 的 message 列表里有 streaming 的才算"在响应中"，
  // 不被其他 session 的流式填充干扰。
  const currentSessionId = useSessionsStore((s) => s.currentSessionId);
  const messages = useCurrentSessionMessages(currentSessionId);
  const sessionIsStreaming = messages.some((m) => m.status === "streaming");

  // 全局 runner 状态 —— 仅用于"防止并发 send"和文案差异。
  // runner 是 chat-store 唯一的实例，切到 B 后仍指向 A 的 runner；
  // 在 B 里点 send 会替换 runner，留下泄漏的 SSE 流。
  // 所以 send guard 用全局判断 + 给用户提示"另一会话在运行"。
  const globalRunnerIsRunning = useChatStore((s) => s.runner?.isRunning() ?? false);

  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
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

  const active = useActiveInstance();
  const userId = active?.userId ?? "";
  const needUserId = !userId.trim() || !active;

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
      return;
    }
    const trimmed = text.trim();
    // globalRunnerIsRunning 守 send 门：避免在另一个 session 还在跑时
    // 替换 runner（runner.abort() 没被调用，老 SSE 流还在持续往 store 写）。
    if (!trimmed || sending || globalRunnerIsRunning) return;
    // 先抓快照再清空——这样 send 失败时还能把原文塞回去。
    const snapshotText = trimmed;
    const snapshotFiles = files;
    setText("");
    setFiles([]);
    setSending(true);
    try {
      await sendMessage({
        text: snapshotText,
        files: snapshotFiles.length > 0 ? snapshotFiles : undefined,
      });
    } catch (err) {
      console.error("sendMessage failed", err);
      alert(err instanceof Error ? err.message : String(err));
      // 失败回滚：把输入内容还回去（覆盖用户在此期间键入的新内容，
      // 但这种竞态极少且"恢复用户原文"对调试更友好）。
      setText(snapshotText);
      setFiles(snapshotFiles);
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
    <div className="w-full min-w-[480px] border-t border-border bg-background/80 backdrop-blur">
      <div className="mx-auto max-w-4xl px-4 py-3">
        {needUserId && (
          <div className="mb-2 flex w-full items-center gap-2 rounded-md border border-warning/40 bg-warning/[0.04] px-3 py-2 text-left">
            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0" />
            <div className="flex-1 text-[12px] text-warning">
              请设置 user_id 后发送消息
            </div>
          </div>
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
            "relative flex min-w-0 items-end gap-2 rounded-xl border bg-card shadow-sm transition-all",
            "focus-within:border-primary/40 focus-within:shadow-md",
            // 边框高亮：仅"本 session 在响应"时亮；别的 session 跑时不影响
            sessionIsStreaming && "border-primary/30",
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
            // 附件按钮：本 session 跑时禁用；其他 session 跑时不禁用
            disabled={sessionIsStreaming || needUserId}
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
              // 三态：本 session 在响应 / 其他 session 跑 / 未设置 user_id
              sessionIsStreaming
                ? "Agent 正在响应…"
                : globalRunnerIsRunning
                ? "另一会话正在运行（请先停止或切换）"
                : needUserId
                ? "先设置 user_id 才能发送消息"
                : "发送消息"
            }
            rows={1}
            // 禁用：本 session 跑 OR 别的 session 跑 OR user_id 未设置
            disabled={sessionIsStreaming || globalRunnerIsRunning || needUserId}
            className="min-w-0 flex-1 min-h-[36px] max-h-[240px] border-0 shadow-none focus-visible:ring-0 bg-transparent resize-none px-1 py-2 text-sm"
          />

          {sessionIsStreaming ? (
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
              disabled={!text.trim() || sending || globalRunnerIsRunning}
              className="mr-1 mb-1 shrink-0"
              title={
                needUserId
                  ? "先设置 user_id"
                  : globalRunnerIsRunning
                  ? "另一会话正在运行"
                  : "发送"
              }
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>

        {/* Bottom row: agent 选择 + (spacer) + user_id。
            min-w-0 + truncate 让两端在窄列里各自 truncate 而非推挤。 */}
        <div className="mt-1.5 flex min-w-0 items-center gap-2 px-1">
          <AgentPicker className="min-w-0 flex-shrink" />
          <div className="flex-1 min-w-0" />
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/80">
            <User className="h-2.5 w-2.5" />
            <span className="font-mono">
              user_id: {userId.trim() || "未设置"}
            </span>
          </span>
        </div>
      </div>
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