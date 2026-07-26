/**
 * user_id 校验 / 解析
 *
 * 每个 AGNO 实例有独立的 userId —— 不同实例用不同身份跟 AGNO 通信。
 * 旧版本里 userId 是全局的（settings-store），现在彻底切到 per-instance。
 * 这个文件集中放校验规则和 helper，避免每处 UI 重复一份正则。
 */

import type { AgnoInstance } from "@/stores/instances-store";

export const USER_ID_MIN = 2;
export const USER_ID_MAX = 64;
export const USER_ID_PATTERN = /^[a-zA-Z0-9_\-@.]+$/;

/**
 * 校验输入是否合法。返回 null 表示通过；否则返回中文错误消息。
 * 容忍 `null` / `undefined` / 非 string 输入（UI 草稿态偶尔会塞奇怪值），
 * 一律按"空"处理。规则（与 AGNO 实际语义保持宽松一致）：
 * - 非空、trim 后 ≥ 2 字符
 * - ≤ 64 字符
 * - 仅字母 / 数字 / 下划线 / 连字符 / @ / .
 */
export function validateUserId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return "user_id 不能为空";
  const trimmed = value.trim();
  if (!trimmed) return "user_id 不能为空";
  if (trimmed.length < USER_ID_MIN) return `至少 ${USER_ID_MIN} 个字符`;
  if (trimmed.length > USER_ID_MAX) return `最多 ${USER_ID_MAX} 个字符`;
  if (!USER_ID_PATTERN.test(trimmed)) {
    return "只能包含字母、数字、下划线、连字符、@、点";
  }
  return null;
}

/** trim 后非空 → 已设置。空串 / undefined / 纯空白都算"未设置"。 */
export function hasUserId(value: string | null | undefined): boolean {
  return !!value && value.trim().length > 0;
}

/** 从 instance 里读出有效的 userId。空 / null / undefined 兜底为 ""。 */
export function getInstanceUserId(instance: AgnoInstance | null | undefined): string {
  return instance?.userId?.trim() ?? "";
}