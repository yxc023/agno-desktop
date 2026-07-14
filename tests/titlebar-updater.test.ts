/**
 * AppTitleBar 下载进度 UI —— 行为回归测试
 *
 * 这个测试关注的是 UI 行为而不是样式：
 *   - downloaded=0 + total>0      → 不渲染百分比（避免"0% 闪一下"违和感）
 *   - downloaded/total 中间值      → 渲染百分比（截断到整数）
 *   - downloaded > total           → clamp 到 100%
 *   - total=null/unknown           → 不渲染百分比，进入"indeterminate"视觉分支
 *   - downloaded/total 极小值      → 不渲染百分比（< 1% 视为 0）
 *
 * 为什么用 renderToStaticMarkup 而不是 jsdom：
 *   - 项目其他测试（markdown-codeblock）也是这套模式，跨文件保持一致。
 *   - 标题栏只关心结构（有没有百分比 span / 进度条宽度），不需要真实 layout。
 *
 * Usage:
 *   bun run tests/titlebar-updater.test.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { DownloadIndicator, UpdateErrorChip } from "../src/components/layout/AppTitleBar";

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

/**
 * 渲染 DownloadIndicator 并抽出：
 * - 是否显示了「%」文字（hasPercentText）
 * - 进度条填充 div 的 width 样式（barWidth, 如 "0%" "37%" "100%"）
 */
function render(
  infoVersion: string | undefined,
  downloaded: number,
  total: number | null
): { hasPercentText: boolean; barWidth: string | null } {
  const html = renderToStaticMarkup(
    React.createElement(DownloadIndicator, {
      infoVersion,
      downloaded,
      total,
    })
  );
  // 百分比文案长这样: `<span ...>37%</span>`
  const percentMatch = html.match(/>(\d+)%</);
  const hasPercentText = percentMatch !== null;
  // 进度条 fill 节点带 inline style width="N%"
  const widthMatch = html.match(/width:\s*(\d+)%/);
  const barWidth = widthMatch ? `${widthMatch[1]}%` : null;
  return { hasPercentText, barWidth };
}

function main(): void {
  // ─────────────── 1) 启动瞬间：0% 不应该渲染 ───────────────
  console.log("=== start: downloaded=0 with known total ===");
  {
    const { hasPercentText, barWidth } = render("0.0.5", 0, 10_000_000);
    assert(hasPercentText === false, "0% is suppressed on download start");
    assert(barWidth === "0%", "bar starts at width 0% (still drawn, just empty)");
  }

  // ─────────────── 2) 中段：百分比按 downloaded/total 计算 ───────────────
  console.log("=== mid-download: 37% ===");
  {
    const { hasPercentText, barWidth } = render("0.0.5", 3_700_000, 10_000_000);
    assert(hasPercentText === true, "percent rendered");
    assert(/\d+%/.test(render("0.0.5", 3_700_000, 10_000_000)["barWidth"] ?? ""), "bar has width style");
    assert(barWidth === "37%", `bar width is 37% (got ${barWidth})`);
  }

  // ─────────────── 3) 即将完成：99% / 100% 边界 ───────────────
  console.log("=== near-complete: 99% then overflow ===");
  {
    const { barWidth: w99 } = render("0.0.5", 9_900_000, 10_000_000);
    assert(w99 === "99%", "99% rounded correctly");
    // downloaded > total：实际下载时 chunk 累加可能短暂超过 contentLength（取决于 server 算法）
    const { barWidth: wOver } = render("0.0.5", 12_000_000, 10_000_000);
    assert(wOver === "100%", "overflow clamps to 100%");
  }

  // ─────────────── 4) total 未知：百分比不渲染，进入 indeterminate 分支 ───────────────
  console.log("=== indeterminate: total=null ===");
  {
    const { hasPercentText, barWidth } = render("0.0.5", 1_000_000, null);
    assert(hasPercentText === false, "no percent when total is unknown");
    assert(barWidth === null, "no width style — uses shimmer animation instead");
  }

  // ─────────────── 5) total=0（server 边界值）：不当作已知总量 ───────────────
  console.log("=== edge: total=0 ===");
  {
    // total=0 → hasTotal=false → 进入 indeterminate 分支，避免 NaN% / Infinity%
    const { hasPercentText, barWidth } = render("0.0.5", 0, 0);
    assert(hasPercentText === false, "total=0 doesn't render percent");
    assert(barWidth === null, "total=0 → indeterminate branch");
  }

  // ─────────────── 6) infoVersion 缺失：fallback 到"正在下载"无版本 ───────────────
  console.log("=== fallback: infoVersion undefined ===");
  {
    const html = renderToStaticMarkup(
      React.createElement(DownloadIndicator, {
        infoVersion: undefined,
        downloaded: 5_000_000,
        total: 10_000_000,
      })
    );
    assert(html.includes("正在下载"), "still shows 正在下载 text");
    // 不应包含 "v" 后面跟版本号的 span
    assert(!/vundefined/.test(html), "no 'vundefined' rendered");
  }

  // ─────────────── 7) 极小百分比 (< 1%)：不显示数字 ───────────────
  console.log("=== very small percent ===");
  {
    // 5000 / 10_000_000 = 0.05% → 截断到 0 → 不显示百分比
    const { hasPercentText, barWidth } = render("0.0.5", 5_000, 10_000_000);
    assert(hasPercentText === false, "< 1% rounds to 0 and is hidden");
    assert(barWidth === "0%", "bar still drawn at 0%");
  }

  // ─────────────── 8) UpdateErrorChip：通用错误 ───────────────
  console.log("=== UpdateErrorChip: generic error ===");
  {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(UpdateErrorChip, {
          error: "network unreachable",
          onRetry: () => {},
        })
      )
    );
    assert(html.includes("更新失败"), "shows 更新失败 label");
    assert(html.includes("重试"), "shows 重试 button");
    assert(html.includes("alert"), "has role=alert for screen readers");
  }

  // ─────────────── 9) UpdateErrorChip：cross-device 错误信息 ───────────────
  console.log("=== UpdateErrorChip: cross-device detection ===");
  {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(UpdateErrorChip, {
          error: "Cross-device link (os error 18)",
          onRetry: () => {},
        })
      )
    );
    assert(html.includes("更新失败"), "still shows 更新失败 label");
    assert(html.includes("重试"), "still shows 重试 button");
    assert(html.includes("alert"), "cross-device error has role=alert");
  }

  // ─────────────── 10) UpdateErrorChip：null error 时不崩溃 ───────────────
  console.log("=== UpdateErrorChip: null error fallback ===");
  {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(UpdateErrorChip, {
          error: null,
          onRetry: () => {},
        })
      )
    );
    assert(html.includes("更新失败"), "renders even with null error");
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