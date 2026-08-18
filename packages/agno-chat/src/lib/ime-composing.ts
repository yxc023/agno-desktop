/**
 * IME (输入法) composition 期间的 Enter 键判定。
 *
 * 背景：
 * 中文 / 日文 / 韩文输入法在用户输入拼音 / 假名 / 谚文时会进入
 * "composition" 状态 —— 此时按 Enter 是「确认候选词」，不是「提交消息」。
 * 如果不识别这个状态，输入框会在用户按 Enter 选词时把未确认的字符（甚至
 * 半个拼音）当成完整消息发出去，造成典型的"误触发送"。
 *
 * W3C 规范 [1] 保证 IME 期间 keydown 事件的 `isComposing=true`，
 * 但跨浏览器实现仍有边界（老 Safari、iOS Gboard、部分 Linux IME
 * 在 compositionend 时序上不一致）。社区共识是三层判定：
 *
 * 1) `composingRef`：由 onCompositionStart / onCompositionEnd 维护，
 *    覆盖 React SyntheticEvent 在事件冒泡 / 跨边界时的同步滞后。
 * 2) `e.nativeEvent.isComposing`：W3C KeyboardEvent 标准属性，
 *    浏览器在 composition 阶段的 keydown 上设为 true。
 * 3) `e.keyCode === 229`：229 是「Process」键，所有 IME 在 composition
 *    阶段都发这个 keyCode；老 Safari / iOS Gboard 在 isComposing
 *    字段未及时更新时仍然会带 keyCode=229，是最稳的兜底。
 *
 * 任意一层为 true 都判定为「IME 输入中」，Enter 不应触发发送。
 *
 * [1] https://www.w3.org/TR/uievents/#dom-keyboardevent-iscomposing
 */

/**
 * Enter 键事件子集 —— 只用我们要判断的字段，避免和 React.KeyboardEvent
 * 类型耦合到组件外部（保持纯函数可单测）。
 */
export interface EnterEvent {
  key: string;
  shiftKey: boolean;
  nativeEvent: {
    isComposing: boolean;
    keyCode: number;
  };
}

/**
 * 给定 keydown 事件 + composition 状态 ref，判断 Enter 是否应当触发「发送」。
 *
 * - 返回 true  → 组件应 `e.preventDefault()` 后调用 send 回调
 * - 返回 false → Enter 不应触发发送（IME 输入中 / Shift+Enter / 其他键）
 *
 * 注意：本函数只判断"是否该发送"，不实际发送。preventDefault 由调用方决定，
 * 因为 IME 期间有时仍希望 Enter 走 IME 默认行为（确认候选词）—— 此时
 * 我们的判断返回 false，调用方就不会 preventDefault，让 IME 自然处理。
 */
export function shouldSendOnEnter(
  e: EnterEvent,
  composingRef: { current: boolean }
): boolean {
  // 不是 Enter 直接 false（包括 Tab / Escape / Backspace / 普通字符键等）
  if (e.key !== "Enter") return false;

  // Shift+Enter = 换行，textarea 默认行为就是插入换行，让它走默认
  if (e.shiftKey) return false;

  // 三层 IME 判定：任意一层为 true 都判定为"输入中"，不要拦截 Enter
  if (composingRef.current) return false;
  if (e.nativeEvent.isComposing) return false;
  if (e.nativeEvent.keyCode === 229) return false;

  return true;
}