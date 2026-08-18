export function openExternalUrl(href: unknown): void {
  if (typeof href !== "string") return;
  window.open(href, "_blank", "noreferrer");
}
