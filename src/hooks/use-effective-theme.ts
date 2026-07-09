/**
 * useEffectiveTheme —— 把 settings-store.theme（可能为 "system"）解析成
 * 实际生效的 "dark" | "light"，并在 OS 主题切换时自动重渲染。
 *
 * 用法：
 *   const effective = useEffectiveTheme();
 *   <Toaster theme={effective} />
 *
 * 为什么需要 hook：直接调 `resolveTheme(theme)` 只会在 settings 变化时
 * 重算，OS 切换主题（prefers-color-scheme 变化）不会触发 React 重渲染，
 * Toaster 等依赖 resolved theme 的组件会保持旧值。
 */
import { useEffect, useState } from "react";
import { resolveTheme, useSettingsStore } from "@/stores/settings-store";

export function useEffectiveTheme(): "dark" | "light" {
  const theme = useSettingsStore((s) => s.theme);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    // 初次 mount 与 OS 切换都会触发此 handler；把 mq.matches 写入 state
    // 触发 useEffectiveTheme 的调用方重渲染。
    const handler = (e: MediaQueryListEvent) => {
      setSystemPrefersDark(e.matches);
    };
    // 现代浏览器用 addEventListener；Safari < 14 走 deprecated addListener。
    if (mq.addEventListener) {
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  // 重新组装一个虚拟 theme：system 模式替换成当前 OS 偏好，这样 resolveTheme
  // 的逻辑可以保持纯净（不在 hook 里硬塞 prefers-color-scheme 判断）。
  const effective: "dark" | "light" = theme === "system"
    ? systemPrefersDark
      ? "dark"
      : "light"
    : theme;
  // 仍然走 resolveTheme 做一次 sanity（处理未来扩展，比如 theme 加 "high-contrast"）
  return resolveTheme(effective);
}