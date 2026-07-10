/**
 * open-external-url — 把"输出内容里的链接"安全地跳到系统默认浏览器
 *
 * 为什么需要这个 helper：
 * - Tauri Webview (WKWebView / WebView2) 默认会拦截 `<a target="_blank">`，
 *   要么在 webview 内开新 tab，要么直接静默失败——用户看到"链接点不开"。
 * - 正确做法是走 tauri-plugin-shell 的 open()，调 OS 默认浏览器。
 * - 渲染层有 3 处都用了 `<a target="_blank">`（markdown 正文 / references /
 *   web_search 结果），集中在一个工具函数里拦截，避免每处都重复写
 *   plugin 调用 + 安全校验。
 *
 * 安全策略：
 * - 白名单协议：只允许 http / https / mailto；其它一律拒绝并 console.warn
 *   （javascript: 在渲染层 inline 已经能被 React/Markdown 触发；data: /
 *   vbscript: / file: 在桌面应用里属于"诱导本地读文件"或"脚本执行"，必须拦）
 * - URL 必须能被 URL 解析（new URL 不抛），否则拒绝
 *
 * 为什么不用 opener crate 直接在 Rust 侧拦：
 * - 前端做协议校验更便宜、错误反馈更直接（console.warn 立刻给 dev 看到）
 * - Rust 侧只需要 plugin 注册 + capability 放行；业务规则在前端一处即可
 */

import { open as openShell } from "@tauri-apps/plugin-shell";

/** 只允许这三种协议走 shell.open。其它一律视作不安全。 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * 判断一个 href 是否可以被 shell.open 安全打开。
 * 纯函数：给定输入返回 true/false，不抛异常。
 *
 * 拒绝：
 *   - 空 / 非字符串
 *   - URL 解析失败的（畸形 URL）
 *   - javascript: / data: / vbscript: / file: / about: 等非 http(s)/mailto 协议
 *   - whitespace-only
 */
export function isSafeExternalUrl(href: unknown): href is string {
  if (typeof href !== "string") return false;
  const trimmed = href.trim();
  if (trimmed.length === 0) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  return ALLOWED_PROTOCOLS.has(parsed.protocol);
}

/**
 * 把外部 URL 交给系统默认浏览器打开。
 *
 * - 非安全 URL：console.warn 提示开发者 / 调用方，不调 shell
 * - shell.open 抛错：console.warn 后 swallow（用户操作失败不应炸 UI；
 *   常见原因是 capability 没放行，dev 自己能看见 console）
 *
 * 渲染层用法：
 *   <a
 *     href={href}
 *     target="_blank"
 *     rel="noreferrer"
 *     onClick={(e) => {
 *       e.preventDefault();
 *       openExternalUrl(href);
 *     }}
 *   >
 */
export async function openExternalUrl(href: unknown): Promise<void> {
  if (!isSafeExternalUrl(href)) {
    // 注意：用 console.warn 而不是 throw——"链接不可点"是用户可见的失败模式，
    // 但调用方通常在 onClick 里不能 await；吞掉错误让 UI 不炸。
    if (typeof console !== "undefined") {
      console.warn(
        "openExternalUrl: refused unsafe or unparseable url",
        { href }
      );
    }
    return;
  }
  try {
    await openShell(href);
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn("openExternalUrl: shell.open failed", { href, err });
    }
  }
}