/**
 * Updater store 状态共享回归测试
 *
 * v0.0.4 → v0.0.5 修复回归测试。
 *
 * 老实现把 state 放在 `useState` 里，导致：
 *   - AppTitleBar 的 useUpdater() state（实例 #1）
 *   - SettingsPage 的 useUpdater() state（实例 #2）
 *   - UpdateToast 的 useUpdater() state（实例 #3）
 * 三份独立、互不可见。
 *
 * 当 SettingsPage 调用 install() 时，只有实例 #2 变成 downloading，
 * AppTitleBar 看到的还是 idle，标题栏不显示进度条——这是用户报告的
 * "点击立即更新之后没有看到标题栏有变化" 的根因。
 *
 * 修复：把 state 挪到 zustand store (`useUpdaterStore`)，三处共享同一份。
 * actions 也共享同一份引用，调用任何一处的 install() 都更新同一份 state。
 *
 * 这个测试不通过 store 的 React 订阅 API，而是直接用 `useUpdaterStore.getState()`
 * 模拟"SettingsPage 触发 install() → AppTitleBar 看见新 state" 的流程，
 * 验证 store 是单一来源。
 *
 * 注：测试环境跑在浏览器（isTauri()=false），所以 isUpdaterAvailable()=false。
 * 我们绕开实际 Tauri 调用，直接通过 store 的 actions 改 state 验证共享性。
 *
 * Usage:
 *   bun run tests/updater-store.test.ts
 */
import { useUpdaterStore } from "../src/stores/updater-store";

// —— assert framework ——
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed++;
    console.error(`✗ ${msg}`);
  } else {
    console.log(`✓ ${msg}`);
  }
}

function main(): void {
  // ─────────────── 1) store 是单例 ───────────────
  console.log("=== store singleton ===");
  {
    // 多次调用拿到的是同一个 store 引用（zustand 模块级 cache 的行为）
    // 这一点在 React 之外用 getState() 也可以验证。
    const s1 = useUpdaterStore.getState();
    const s2 = useUpdaterStore.getState();
    assert(s1 === s2, "useUpdaterStore.getState() returns same reference");
  }

  // ─────────────── 2) action 调用会改变 store state ───────────────
  console.log("=== actions mutate shared state ===");
  {
    // 重置：把状态归零
    useUpdaterStore.setState({
      status: "available",
      info: { version: "9.9.9" },
      downloaded: 0,
      total: null,
      error: null,
      lastChecked: null,
      available: true,
    });

    // 模拟 SettingsPage 触发 dismiss（任何调用方都会影响所有订阅者）
    useUpdaterStore.getState().dismiss();

    const after = useUpdaterStore.getState();
    assert(after.status === "idle", "dismiss() → status=idle");
    assert(after.error === null, "dismiss() → error cleared");
    // 注：info 不清除——dismiss 把 status 归零但保留 info，
    // 这样下次 checkNow 不需要重新走网络就能知道"曾经发现过 v9.9.9"。
    // 实际 UI 行为：status=idle 时 title bar 和 toast 都不渲染 info。
    assert(after.info?.version === "9.9.9", "dismiss() preserves info (by design)");
  }

  // ─────────────── 3) clearError 也是全局生效 ───────────────
  console.log("=== clearError globally resets error ===");
  {
    useUpdaterStore.setState({
      status: "error",
      error: "Cross-device link (os error 18)",
    });
    useUpdaterStore.getState().clearError();
    const after = useUpdaterStore.getState();
    assert(after.status === "idle", "clearError() → status=idle");
    assert(after.error === null, "clearError() → error=null");
  }

  // ─────────────── 4) install 失败 → error 在 store 里 ───────────────
  // 模拟 downloadAndInstall 失败（通过 monkey-patch 一个 import 路径不可行，
  // 我们用 setState 模拟"已经处于 downloading 状态"的瞬态，然后手动触发
  // clearError 来验证 store 的状态机连贯性）。
  console.log("=== state transitions reachable via store ===");
  {
    // 模拟 user click install → status=downloading
    useUpdaterStore.setState({
      status: "downloading",
      info: { version: "9.9.9" },
      downloaded: 0,
      total: 10_000_000,
      error: null,
    });
    const s1 = useUpdaterStore.getState();
    assert(s1.status === "downloading", "manual setState to downloading persists");

    // 模拟 progress chunk 到达
    useUpdaterStore.setState((s) => ({ downloaded: s.downloaded + 5_000_000 }));
    const s2 = useUpdaterStore.getState();
    assert(s2.downloaded === 5_000_000, "downloaded counter increments");

    // 模拟 ready
    useUpdaterStore.setState({ status: "ready" });
    const s3 = useUpdaterStore.getState();
    assert(s3.status === "ready", "status → ready");

    // 模拟 install 失败（plugin 抛 cross-device error）
    useUpdaterStore.setState({
      status: "error",
      error: "Cross-device link (os error 18)",
    });
    const s4 = useUpdaterStore.getState();
    assert(s4.status === "error", "status → error on install failure");
    assert(s4.error?.includes("Cross-device"), "error message preserved");
  }

  // ─────────────── 5) zustand subscribe 机制——多个"组件"看见同一份 state ───────────────
  console.log("=== multiple subscribers see same state ===");
  {
    // 重置
    useUpdaterStore.setState({
      status: "idle",
      info: null,
      downloaded: 0,
      total: null,
      error: null,
    });

    // 模拟两个"组件"各自订阅 state
    const sub1Calls: number[] = [];
    const sub2Calls: number[] = [];

    const unsub1 = useUpdaterStore.subscribe((s) => {
      sub1Calls.push(s.downloaded);
    });
    const unsub2 = useUpdaterStore.subscribe((s) => {
      sub2Calls.push(s.downloaded);
    });

    // 模拟 progress 事件
    useUpdaterStore.setState((s) => ({ downloaded: s.downloaded + 1000 }));
    useUpdaterStore.setState((s) => ({ downloaded: s.downloaded + 2000 }));
    useUpdaterStore.setState((s) => ({ downloaded: s.downloaded + 3000 }));

    // 两个订阅者都收到了所有变化
    assert(sub1Calls.length === 3, `subscriber1 got all 3 updates (got ${sub1Calls.length})`);
    assert(sub2Calls.length === 3, `subscriber2 got all 3 updates (got ${sub2Calls.length})`);
    assert(
      sub1Calls[sub1Calls.length - 1] === 6000,
      `subscriber1 sees latest downloaded=6000`
    );
    assert(
      sub2Calls[sub2Calls.length - 1] === 6000,
      `subscriber2 sees latest downloaded=6000`
    );

    unsub1();
    unsub2();
  }

  // ─────────────── 6) setError: 重启失败时切到 error 状态 ───────────────
  console.log("=== setError action (relaunch failure path) ===");
  {
    // 模拟 ready → dismiss → 重启失败的连续状态
    useUpdaterStore.setState({
      status: "ready",
      info: { version: "9.9.9" },
      downloaded: 12_000_000,
      total: 12_000_000,
      error: null,
    });
    // 用户点重启 → dismiss 把 status 切到 idle
    useUpdaterStore.getState().dismiss();
    assert(
      useUpdaterStore.getState().status === "idle",
      "after dismiss, status is idle"
    );
    // relaunchApp() 失败 → AppTitleBar 调 setError
    useUpdaterStore.getState().setError("重启失败：plugin-process 未注册");
    const after = useUpdaterStore.getState();
    assert(after.status === "error", "setError → status=error");
    assert(
      after.error?.includes("plugin-process"),
      `error message preserved (got: ${after.error})`
    );
    // 此时 title bar 应该看到 error 状态 + 显示 retry 按钮
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