/**
 * detectPreviewKind — 把 URL 路径归类到一种 PreviewKind，用于决定是
 * "在面板里预览" 还是 "fallback 到 openExternalUrl 跳系统浏览器"。
 *
 * 纯函数：给定 href 字符串返回 "md" | "text" | "code" | "image" | "html"
 * 或 null。null 表示无可识别的扩展名 / 输入非法，调用方应当走 fallback。
 *
 * 设计要点：
 * - 扩展名取自 URL path 的**最后一个**段；query / fragment / hash 都要剥离。
 * - 大小写不敏感（URL 路径段大小写在 RFC 3986 是允许的，但服务端一般不区分）。
 * - 非字符串 / 空 / 全空白输入一律返回 null，绝不抛。
 * - 故意不支持扩展名以外的信号（content-type 探测需要先 HEAD 请求；
 *   文件预览场景下扩展名判断足够覆盖 99% 用例，且零网络开销）。
 */

export type PreviewKind = "md" | "text" | "code" | "image" | "html";

const KIND_BY_EXT: Record<string, PreviewKind> = {
  // markdown
  md: "md",
  markdown: "md",
  // plain text
  txt: "text",
  log: "text",
  // images
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  // html
  html: "html",
  htm: "html",
  // structured / code
  json: "code",
  yaml: "code",
  yml: "code",
  csv: "code",
  tsv: "code",
  xml: "code",
  toml: "code",
  conf: "code",
  ini: "code",
  env: "code",
  py: "code",
  ts: "code",
  tsx: "code",
  js: "code",
  jsx: "code",
  mjs: "code",
  cjs: "code",
  go: "code",
  rs: "code",
  java: "code",
  c: "code",
  h: "code",
  cpp: "code",
  cc: "code",
  cxx: "code",
  hpp: "code",
  cs: "code",
  rb: "code",
  php: "code",
  sh: "code",
  bash: "code",
  zsh: "code",
  fish: "code",
  sql: "code",
  kt: "code",
  swift: "code",
  scala: "code",
};

export function detectPreviewKind(href: unknown): PreviewKind | null {
  if (typeof href !== "string") return null;
  const trimmed = href.trim();
  if (trimmed.length === 0) return null;

  // 取路径段。query / fragment 用 ? # 切掉（URL 本身的解析留到 caller 决定
  // 是否安全打开；这里只关心"看起来像什么文件"）。
  let path = trimmed;
  const hashIdx = path.indexOf("#");
  if (hashIdx !== -1) path = path.slice(0, hashIdx);
  const qIdx = path.indexOf("?");
  if (qIdx !== -1) path = path.slice(0, qIdx);

  // 路径里最后一个 / 之后的段
  const lastSlash = path.lastIndexOf("/");
  const lastSeg = lastSlash === -1 ? path : path.slice(lastSlash + 1);
  if (lastSeg.length === 0) return null;

  // 最后一个 . 之后的扩展名（小写化）
  const lastDot = lastSeg.lastIndexOf(".");
  if (lastDot === -1 || lastDot === lastSeg.length - 1) return null;
  const ext = lastSeg.slice(lastDot + 1).toLowerCase();

  return KIND_BY_EXT[ext] ?? null;
}

/**
 * resolvePreviewUrl — 把 agent 给的「相对 / 准协议 URL」拼到当前实例
 * 的 baseUrl 后面，返回一个 fetch 能直接 handle 的完整 URL。
 *
 * 三种 agno 实际输出的格式（皆指向当前实例上的资源）：
 *   1. file_path:requirements/foo.md      —— 自定义 scheme
 *   2. //requirements/foo.md              —— protocol-relative
 *   3. /requirements/foo.md               —— absolute path
 *
 * 全部解析为 `<baseUrl><path>`。baseUrl 两种典型形态：
 *   - http(s)://host:port（生产 / Tauri runtime）
 *   - /api（Vite dev proxy，浏览器 dev 模式）
 *   - 带或不带尾斜杠都会被规范化（拼接前 strip 一次）。
 *
 * 已经完整的 URL（http:// / https://）原样返回，不动。
 *
 * 故意不解析纯 relative path（"requirements/foo.md" 没前导斜杠）——
 * 那在 baseUrl 语境里歧义太大，留给 fallback 走 openExternalUrl / 新 URL 失败。
 *
 * 非字符串 href / 空 baseUrl 全部 pass-through（caller 自己兜底）。
 */
export function resolvePreviewUrl(href: unknown, baseUrl: string): string {
  if (typeof href !== "string") return href as string;
  if (!baseUrl) return href;

  // file_path:<rest>  —— 去 scheme，前导 / 容错
  if (href.startsWith("file_path:")) {
    const rest = href.slice("file_path:".length);
    const path = rest.startsWith("/") ? rest : "/" + rest;
    return joinUrl(baseUrl, path);
  }

  // //<path>  —— protocol-relative，去掉一个 /
  if (href.startsWith("//")) {
    return joinUrl(baseUrl, href.slice(1));
  }

  // /<path>  —— absolute path，直接拼
  if (href.startsWith("/")) {
    return joinUrl(baseUrl, href);
  }

  // 已经是完整 URL / 其他情况 → 原样返回
  return href;
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return trimmedBase + path;
}