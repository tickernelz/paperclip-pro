import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { probeSidebarNav, type NavItemProbe } from "./sidebar-active-probe";

const MARKER_MIN = 3;
const TEXT_MIN = 4.5;
const ICON_MIN = 3;
const LAYOUTS = [
  { name: "labels", viewport: { width: 1400, height: 900 }, rail: false },
  { name: "rail", viewport: { width: 900, height: 800 }, rail: true },
] as const;
const EXPECTED_ITEMS = 2 * 5;

function failuresOf(item: NavItemProbe, hover: NavItemProbe | undefined): string[] {
  const failures: string[] = [];
  if (item.text !== null && item.text < TEXT_MIN) failures.push(`text ${item.text} < ${TEXT_MIN}`);
  if (item.icon !== null && item.icon < ICON_MIN) failures.push(`icon ${item.icon} < ${ICON_MIN}`);
  if (item.expect === "active") {
    if (item.ariaCurrent !== "page") failures.push(`aria-current ${item.ariaCurrent}`);
    if (item.markerVsRow === null) failures.push("no active marker");
    else if (item.markerVsRow < MARKER_MIN) failures.push(`marker vs row ${item.markerVsRow} < ${MARKER_MIN}`);
    if (hover && hover.row === item.row) failures.push(`active background equals hover ${item.row}`);
  } else {
    if (item.ariaCurrent !== null) failures.push(`aria-current ${item.ariaCurrent} on inactive item`);
    if (item.marker !== null) failures.push(`${item.state} item shows the active marker`);
  }
  return failures;
}

for (const layout of LAYOUTS) {
  test(`active sidebar item stands out from rest and hover (${layout.name})`, async ({ page }, testInfo) => {
    await page.setViewportSize(layout.viewport);
    await page.route((url) => url.pathname.startsWith("/api/"), (route) => route.abort());
    await page.goto("/tests/sidebar-nav-gallery.html");
    await page.locator("[data-nav-gallery-ready]").waitFor();
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });
    const rest = await page.evaluate(probeSidebarNav, "rest");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
    const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "[data-nav-item] a" });
    for (const nodeId of nodeIds) await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] });
    const hover = await page.evaluate(probeSidebarNav, "hover");
    for (const nodeId of nodeIds) await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
    const hoverRestBySurface = new Map(hover.filter((item) => item.expect === "rest").map((item) => [item.id.split("/")[0], item]));
    const rows = [...rest, ...hover].map((item) => ({
      ...item,
      failures: failuresOf(item, item.state === "rest" ? hoverRestBySurface.get(item.id.split("/")[0]) : undefined),
    }));
    const activeRest = rows.filter((row) => row.expect === "active" && row.state === "rest");
    const summary = {
      layout: layout.name,
      lowestMarkerVsRow: Math.min(...activeRest.map((row) => row.markerVsRow ?? 0)),
      lowestMarkerVsSurface: Math.min(...activeRest.map((row) => row.markerVsSurface ?? 0)),
      lowestActiveText: Math.min(...activeRest.map((row) => row.text ?? Infinity)),
      lowestIcon: Math.min(...rows.map((row) => row.icon ?? Infinity)),
      activeVsHover: activeRest.map((row) => {
        const hoverRow = hoverRestBySurface.get(row.id.split("/")[0])!;
        return { id: row.id, active: row.row, hover: hoverRow.row, surface: row.surface, activeRowVsSurface: row.rowVsSurface, hoverRowVsSurface: hoverRow.rowVsSurface };
      }),
    };
    const reportPath = testInfo.outputPath(`sidebar-active-${layout.name}.json`);
    writeFileSync(reportPath, JSON.stringify({ summary, rows }, null, 1));
    await testInfo.attach(`sidebar-active-${layout.name}`, { path: reportPath, contentType: "application/json" });
    console.log(JSON.stringify(summary));
    expect(rest).toHaveLength(EXPECTED_ITEMS);
    expect(rest.every((item) => item.rail === layout.rail)).toBe(true);
    expect(rows.filter((row) => row.failures.length > 0).map((row) => `${row.id} [${row.state}] ${row.failures.join(", ")}`)).toEqual([]);
  });
}
