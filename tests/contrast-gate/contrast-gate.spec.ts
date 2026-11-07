import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { probeRenderedContrast, type ContrastItem } from "./contrast-probe";

const EXPECTED_REST_ITEMS = 2 * 3 * 41;
const TEXT_MIN = 4.5;
const LARGE_TEXT_MIN = 3;
const BOUNDARY_MIN = 3;
const FOCUS_RING_MIN = 3;
const FORCED_STATES: Array<{ state: string; pseudo: string[] }> = [
  { state: "hover", pseudo: ["hover"] },
  { state: "press", pseudo: ["hover", "active"] },
  { state: "focus", pseudo: ["focus", "focus-visible"] },
];

function failuresOf(item: ContrastItem): string[] {
  const failures: string[] = [];
  const floor = item.large ? LARGE_TEXT_MIN : TEXT_MIN;
  if (item.minText !== null && item.minText < floor) failures.push(`text ${item.minText} < ${floor}`);
  if (item.boundary !== null && item.boundary < BOUNDARY_MIN) failures.push(`boundary ${item.boundary} < ${BOUNDARY_MIN}`);
  if (item.state === "focus" && item.focusable && item.focusRing === null) failures.push("no visible focus indicator");
  if (item.state === "focus" && item.focusRing !== null && item.focusRing < FOCUS_RING_MIN) failures.push(`focus ring ${item.focusRing} < ${FOCUS_RING_MIN}`);
  return failures;
}

test("every component variant, state and theme meets rendered contrast", async ({ page }, testInfo) => {
  await page.route((url) => url.pathname.startsWith("/api/"), (route) => route.abort());
  await page.goto("/tests/component-gallery.html");
  await page.locator("[data-gallery-ready]").waitFor();
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" });

  const items = await page.evaluate(probeRenderedContrast, "rest");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
    nodeId: root.nodeId,
    selector: "button[data-gallery-item]:not([disabled]), [data-gallery-item] a",
  });
  for (const { state, pseudo } of FORCED_STATES) {
    for (const nodeId of nodeIds) await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: pseudo });
    items.push(...(await page.evaluate(probeRenderedContrast, state)));
    for (const nodeId of nodeIds) await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
  }

  const rows = items.map((item) => ({ ...item, failures: failuresOf(item) }));
  const failing = rows.filter((row) => row.failures.length > 0);
  const measured = rows.filter((row) => row.minText !== null);
  const lowest = measured.reduce<(typeof rows)[number] | null>((low, row) => (low === null || row.minText! < low.minText! ? row : low), null);
  const summary = {
    audited: rows.length,
    buttons: rows.filter((row) => /\/(button|icon)\./.test(row.id)).length,
    failing: failing.length,
    lowestText: lowest ? { id: lowest.id, state: lowest.state, ratio: lowest.minText } : null,
    lowestBoundary: Math.min(...rows.filter((row) => row.boundary !== null).map((row) => row.boundary!)),
    focusMeasured: rows.filter((row) => row.state === "focus" && row.focusable && row.focusRing !== null).length,
    focusExpected: rows.filter((row) => row.state === "focus" && row.focusable).length,
    lowestFocusRing: Math.min(...rows.filter((row) => row.state === "focus" && row.focusRing !== null).map((row) => row.focusRing!)),
  };
  const reportPath = testInfo.outputPath("contrast-report.json");
  writeFileSync(reportPath, JSON.stringify({ summary, failing, rows }, null, 1));
  await testInfo.attach("contrast-report", { path: reportPath, contentType: "application/json" });
  console.log(JSON.stringify(summary));

  expect(rows.filter((row) => row.state === "rest").length, "gallery rendered every item").toBe(EXPECTED_REST_ITEMS);
  expect(failing.map((row) => `${row.id} [${row.state}] ${row.failures.join(", ")}`)).toEqual([]);
});
