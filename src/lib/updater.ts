/**
 * updater — Tauri 自动更新封装
 *
 * 为什么需要这个文件：
 * - `@tauri-apps/plugin-updater` 的 API 表面比较"底层"：check() 返回
 *   `Update | null`，但 Update 实例在浏览器 dev 模式下根本拿不到。
 * - 把"是否能更新 / 检查 / 下载 / 安装 / 监听进度 / 错误归一化"
 *   集中到一个文件，让 hook 和 UI 组件不用关心 Tauri runtime
 *   检测和平台兼容性。
 * - 错误归一化非常关键：plugin 抛出的错误对象在不同 Tauri 版本里
 *   shape 不一样（rust 端 panic 转 string vs JS Error），UI 层若直接
 *   把 err 字符串化展示，用户看到的是 "Error: ..." 这种噪音。这里
 *   统一成用户可读的中文短语 + dev 可读的详细原因。
 *
 * 浏览器 dev 环境（Tauri runtime 不可用）：
 * - 所有函数安全 no-op + 返回有意义的结果：
 *     isUpdaterAvailable() -> false
 *     checkForUpdate()    -> null
 *     downloadAndInstall() -> { ok: false, reason: "dev-mode" }
 * - 不会抛异常。这样 hook 不需要写 try/catch 套娃。
 *
 * 平台支持：
 * - Tauri 2 的 updater 当前支持 macOS / Windows / Linux（deb/AppImage）。
 * - iOS / Android 通过 mobile bundle 走 store 更新，不走这个 plugin。
 * - dev（cargo run / tauri dev）默认会禁用更新检查；这里通过
 *   `isUpdaterAvailable()` 拦截，把 UI 灰显。
 */

import { isTauri } from "./tauri";

/** 下载进度事件类型（与 plugin-updater 的 onProgress 回调 shape 对齐） */
export type UpdateProgressEvent =
  | { kind: "started"; contentLength?: number }
  | { kind: "progress"; chunkLength: number }
  | { kind: "finished" };

/** 进度回调 */
export type ProgressCallback = (event: UpdateProgressEvent) => void;

/** Update 元数据（UI 展示用） */
export interface UpdateInfo {
  /** 新版本号（eg "0.0.3"） */
  version: string;
  /** 发布日期（ISO 8601），可能不存在 */
  date?: string;
  /** 更新说明 / changelog，可能不存在 */
  notes?: string;
}

/** 安装结果 */
export type InstallResult =
  | { ok: true }
  | { ok: false; reason: InstallFailureReason; message: string };

export type InstallFailureReason =
  | "no-update" // 没有可用更新
  | "dev-mode" // 浏览器或 Tauri dev 模式
  | "unsupported-platform" // 不支持的平台（iOS / Android）
  | "network" // 网络错误
  | "signature" // 签名校验失败
  | "permission" // capability 没放行
  | "unknown";

/**
 * 是否可以走 updater。
 *
 * 判定链：
 * 1. 必须运行在 Tauri webview 里（isTauri）
 * 2. 不能是 Tauri dev 模式（dev 模式 plugin 不实际拉 endpoint，会报错）
 * 3. 不能是 iOS / Android（mobile 走 store 更新）
 *
 * 注：dev 模式判定依赖 `import.meta.env.DEV`。Vite/Tauri 都用这个
 * 约定，浏览器 dev（vite serve）下也是 true，但步骤 1 已经把它拦了。
 */
export function isUpdaterAvailable(): boolean {
  if (!isTauri()) return false;
  // import.meta.env.DEV 在 build 时被 Vite 替换成字面量 false，
  // 死代码消除掉；这里能跑到说明确实是 dev 构建。
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    return false;
  }
  // mobile bundle（iOS / Android）走应用商店，不走这个 plugin
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return false;
  }
  return true;
}

/**
 * 检查是否有可用更新。
 *
 * 返回值：
 * - null：检查完成但没有新版本（或 dev-mode / 不支持平台）
 * - UpdateInfo：有可用更新，含版本号 / 日期 / changelog
 *
 * 抛出：网络错误 / 签名校验失败等（直接抛出，不归一化——
 * hook 层会捕获并塞到 UpdaterState.error，由 UI 决定 toast 文案）
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isUpdaterAvailable()) return null;
  // 动态 import：避免在浏览器 dev bundle 中拉入 Tauri native 代码
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  // plugin-updater 的 Update 对象在 v2 中暴露 version / date / notes
  // 字段（取决于 server 端 latest.json 的 schema）
  const info: UpdateInfo = {
    version: (update as unknown as { version?: string }).version ?? "",
  };
  const meta = (update as unknown as {
    date?: string;
    notes?: string;
    body?: string;
  });
  if (meta.date) info.date = meta.date;
  if (meta.notes) info.notes = meta.notes;
  else if (meta.body) info.notes = meta.body;
  return info;
}

/**
 * 下载并安装更新。
 *
 * 行为：
 * - 后台下载（带进度回调）
 * - 下载完成 + 校验通过后：macOS / Linux 自动重启并应用；Windows 弹出
 *   安装器对话框（受 bundle.updater.windows.installMode 控制）
 * - 成功后用户应被引导调用 relaunch() 或重启应用
 *
 * 不抛异常，统一返回 InstallResult：
 * - ok=true：下载完成 + 即将安装（platform-specific 行为）
 * - ok=false：失败原因 + 用户可读消息
 */
export async function downloadAndInstall(
  onProgress?: ProgressCallback
): Promise<InstallResult> {
  if (!isUpdaterAvailable()) {
    return {
      ok: false,
      reason: "dev-mode",
      message: "当前不是 Tauri 桌面环境，无法更新",
    };
  }
  let update: unknown;
  try {
    const mod = await import("@tauri-apps/plugin-updater");
    update = await mod.check();
  } catch (err) {
    return {
      ok: false,
      reason: classifyError(err),
      message: formatError(err, "检查更新失败"),
    };
  }
  if (!update) {
    return {
      ok: false,
      reason: "no-update",
      message: "没有可用更新",
    };
  }

  try {
    // plugin-updater v2 的 downloadAndInstall 支持 progress callback
    // shape: { event: 'Started'|'Progress'|'Finished', data: {...} }
    const u = update as {
      downloadAndInstall: (cb?: (p: unknown) => void) => Promise<void>;
    };
    await u.downloadAndInstall((p) => {
      if (!onProgress) return;
      const evt = p as { event?: string; data?: { contentLength?: number; chunkLength?: number } };
      switch (evt.event) {
        case "Started":
          onProgress({ kind: "started", contentLength: evt.data?.contentLength });
          break;
        case "Progress":
          onProgress({ kind: "progress", chunkLength: evt.data?.chunkLength ?? 0 });
          break;
        case "Finished":
          onProgress({ kind: "finished" });
          break;
      }
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: classifyError(err),
      message: formatError(err, "下载更新失败"),
    };
  }
}

/**
 * 重启应用以应用已下载的更新。
 *
 * 注意：仅 Windows 安装器模式（installMode=passive）需要在更新下载完成后
 * 手动重启；其它平台 downloadAndInstall() 内部已经处理重启。
 * 调用方应根据平台决定是否调用此函数。
 */
export async function relaunchApp(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch {
    // 静默：relaunch 失败通常意味着不支持或权限不足，由用户手动重启
  }
}

/** 当前是否 Windows（用于决定是否需要 manual relaunch） */
export function isWindowsDesktop(): boolean {
  if (typeof navigator === "undefined") return false;
  // Tauri 注入 navigator.platform，但 webview UA 也带 "Windows"
  return /Windows/i.test(navigator.userAgent || "");
}

/* ---------------------------------------------------------------- *
 * 内部：错误归一化
 * ---------------------------------------------------------------- */

/** 把 plugin 抛出的错误归类成 InstallFailureReason */
function classifyError(err: unknown): InstallFailureReason {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  if (/network|fetch|timeout|econn|enotfound/i.test(msg)) return "network";
  if (/sign|verif|pubkey|signature/i.test(msg)) return "signature";
  if (/permission|capability|denied|forbidden/i.test(msg)) return "permission";
  if (/platform|unsupported/i.test(msg)) return "unsupported-platform";
  return "unknown";
}

/** 把错误格式化成用户可读的中文短语 */
function formatError(err: unknown, fallback: string): string {
  const e = err as Error;
  const raw = e?.message ?? String(err);
  if (!raw || raw === "[object Object]") return fallback;
  // 截断：plugin 错误堆栈经常带很长的 rust 端 backtrace
  const firstLine = raw.split("\n")[0]?.trim() ?? fallback;
  return firstLine.length > 200 ? firstLine.slice(0, 200) + "…" : firstLine;
}