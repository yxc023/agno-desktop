/**
 * Test: shouldSendOnEnter — IME composition-aware Enter handling.
 *
 * 用户在中文/日文/韩文输入法下输入时按 Enter 应该是"确认候选词"，
 * 而不是"发送消息"。这个测试覆盖三种判定层 + 边界组合，确保
 * MessageInput 不会误触发送。
 *
 * Usage:
 *   bun run test (or) bun run tests/ime-composing.test.ts
 */
import { shouldSendOnEnter, type EnterEvent } from "../src/lib/ime-composing";

// —— helpers ——
// 构造一个最小 keydown 事件对象（只覆盖我们要的字段）
function makeEvent(opts: {
  key?: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
} = {}): EnterEvent {
  return {
    key: opts.key ?? "Enter",
    shiftKey: opts.shiftKey ?? false,
    nativeEvent: {
      isComposing: opts.isComposing ?? false,
      keyCode: opts.keyCode ?? 0,
    },
  };
}

// —— assert framework（与项目其他 test 文件保持一致）——
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed++;
    console.error(`✗ ${msg}`);
  } else {
    console.log(`✓ ${msg}`);
  }
}

async function main(): Promise<void> {
  // ───────────────────── 基础：普通 Enter → 应该发送 ─────────────────────
  {
    const ref = { current: false };
    const e = makeEvent({ key: "Enter" });
    assert(
      shouldSendOnEnter(e, ref) === true,
      "plain Enter (no IME state) should send"
    );
  }

  // ───────────────────── Shift+Enter → 不应该发送（换行） ─────────────────────
  {
    const ref = { current: false };
    const e = makeEvent({ key: "Enter", shiftKey: true });
    assert(
      shouldSendOnEnter(e, ref) === false,
      "Shift+Enter should NOT send (it inserts a newline)"
    );
  }

  // ───────────────────── IME 期间 Enter：composingRef=true ─────────────────────
  {
    // 模拟 React SyntheticEvent 边界：ref 已被 onCompositionStart 标记，
    // 但 isComposing / keyCode 还没及时更新。
    const ref = { current: true };
    const e = makeEvent({ key: "Enter" });
    assert(
      shouldSendOnEnter(e, ref) === false,
      "Enter during composition (composingRef=true) should NOT send"
    );
  }

  // ───────────────────── IME 期间 Enter：e.nativeEvent.isComposing=true ─────────────────────
  {
    // W3C 标准路径：Chrome/Firefox/Edge 在 IME keydown 时 isComposing=true。
    const ref = { current: false };
    const e = makeEvent({ key: "Enter", isComposing: true });
    assert(
      shouldSendOnEnter(e, ref) === false,
      "Enter with isComposing=true should NOT send (W3C standard)"
    );
  }

  // ───────────────────── IME 期间 Enter：keyCode===229 ─────────────────────
  {
    // 老 Safari / iOS Gboard 兜底：isComposing 没及时更新但 keyCode=229。
    const ref = { current: false };
    const e = makeEvent({ key: "Enter", keyCode: 229 });
    assert(
      shouldSendOnEnter(e, ref) === false,
      "Enter with keyCode=229 (Process key) should NOT send (legacy fallback)"
    );
  }

  // ───────────────────── IME 期间 Enter：三层全部 true（worst case） ─────────────────────
  {
    const ref = { current: true };
    const e = makeEvent({ key: "Enter", isComposing: true, keyCode: 229 });
    assert(
      shouldSendOnEnter(e, ref) === false,
      "Enter with all IME flags set should NOT send (defense in depth)"
    );
  }

  // ───────────────────── IME 期间 Enter：仅 isComposing=false 但 keyCode=229（兜底） ─────────────────────
  {
    // 关键边界：isComposing 字段未及时更新（Safari bug），但 keyCode=229 已带。
    // 我们的判定不应该依赖 isComposing 单独，必须叠加 keyCode 兜底。
    const ref = { current: false };
    const e = makeEvent({ key: "Enter", isComposing: false, keyCode: 229 });
    assert(
      shouldSendOnEnter(e, ref) === false,
      "Enter with isComposing=false but keyCode=229 should still NOT send (keyCode is the safety net)"
    );
  }

  // ───────────────────── IME 期间 Enter：仅 ref=true 其余 false ─────────────────────
  {
    // 关键边界：ref 已标记（onCompositionStart 触发），但 nativeEvent 还没来
    // （合成 React 事件冒泡时序问题）。单靠 ref 应足以挡住。
    const ref = { current: true };
    const e = makeEvent({ key: "Enter", isComposing: false, keyCode: 0 });
    assert(
      shouldSendOnEnter(e, ref) === false,
      "Enter with only composingRef=true should NOT send (ref is first line of defense)"
    );
  }

  // ───────────────────── 非 Enter 键：全部场景都不应发送 ─────────────────────
  {
    const cases: Array<[string, EnterEvent]> = [
      ["Tab", makeEvent({ key: "Tab" })],
      ["Escape", makeEvent({ key: "Escape" })],
      ["Backspace", makeEvent({ key: "Backspace" })],
      ["a", makeEvent({ key: "a" })],
      [" ", makeEvent({ key: " " })],
      ["ArrowUp", makeEvent({ key: "ArrowUp" })],
    ];
    for (const [label, e] of cases) {
      assert(
        shouldSendOnEnter(e, { current: false }) === false,
        `non-Enter key "${label}" should NOT send`
      );
    }
  }

  // ───────────────────── Enter + ShiftKey=true 在 IME 中：仍然不发送 ─────────────────────
  {
    // Shift+Enter 在 IME 中也走 IME 默认行为（不一定是换行）。
    // 我们的判定已经先 short-circuit shiftKey，再检查 IME，所以两种顺序都安全。
    const ref = { current: true };
    const e = makeEvent({ key: "Enter", shiftKey: true, isComposing: true });
    assert(
      shouldSendOnEnter(e, ref) === false,
      "Shift+Enter during IME should NOT send (let IME handle)"
    );
  }

  // ───────────────────── ref.current 在测试间不串扰（独立 ref 实例） ─────────────────────
  {
    const refA = { current: true };
    const refB = { current: false };
    const e = makeEvent({ key: "Enter" });
    assert(
      shouldSendOnEnter(e, refA) === false && shouldSendOnEnter(e, refB) === true,
      "composingRef should be per-instance (no cross-call bleed)"
    );
  }

  console.log(
    `\n${failed === 0 ? "✅ all assertions passed" : `❌ ${failed} assertions failed`}`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});