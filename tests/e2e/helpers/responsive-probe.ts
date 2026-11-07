import type { Page } from "@playwright/test";

export type ResponsiveFinding = {
  width: number;
  scrollWidth: number;
  mainOverflow: number;
  overflowRight: number;
  overflowing: string[];
  smallTargets: string[];
};

export const RESPONSIVE_SIZES = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

export const TOUCH_TARGET_FLOOR = 24;
export const TOUCH_TARGET_BREAKPOINT = 1024;

export async function probeResponsive(page: Page): Promise<ResponsiveFinding> {
  return page.evaluate(({ floor, breakpoint }) => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const describe = (element: Element) => {
      const label = element.getAttribute("aria-label") ?? element.getAttribute("data-testid") ?? element.textContent?.trim().slice(0, 32) ?? "";
      const className = typeof element.className === "string" ? element.className.split(/\s+/).slice(0, 3).join(".") : "";
      return `${element.tagName.toLowerCase()}${className ? `.${className}` : ""}[${label}]`;
    };
    const isShellBoundary = (element: Element) =>
      element === document.documentElement
      || element === document.body
      || element.id === "main-content"
      || element.hasAttribute("data-app-shell");
    const hidden = (element: Element) => {
      if (getComputedStyle(element).visibility !== "visible") return true;
      if (element.closest("[inert],[aria-hidden=true]") !== null) return true;
      for (let node: Element | null = element; node; node = node.parentElement) {
        if (Number(getComputedStyle(node).opacity) === 0) return true;
      }
      return false;
    };
    const offscreenFixedRoot = (element: Element) => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        if (getComputedStyle(node).position !== "fixed") continue;
        const rect = node.getBoundingClientRect();
        return rect.right <= 0 || rect.left >= width || rect.bottom <= 0 || rect.top >= height;
      }
      return false;
    };
    const main = document.getElementById("main-content");
    const mainRect = main?.getBoundingClientRect();
    const mainEnd = main && mainRect ? Math.min(width, mainRect.left + main.clientLeft + main.clientWidth) : width;
    const mainStart = mainRect ? Math.max(0, mainRect.left) : 0;
    const limits = (element: Element) =>
      main?.contains(element) && element !== main ? { start: mainStart, end: mainEnd } : { start: 0, end: width };
    const clipped = (element: Element, end: number) => {
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (isShellBoundary(parent)) continue;
        if (!/(hidden|auto|scroll|clip)/.test(getComputedStyle(parent).overflowX)) continue;
        if (parent.getBoundingClientRect().right <= end + 0.5) return true;
      }
      return false;
    };

    const offenders = new Set<Element>();
    let overflowRight = 0;
    for (const element of document.querySelectorAll("body *")) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) continue;
      const { start, end } = limits(element);
      if (rect.right <= end + 0.5 && rect.left >= start - 0.5) continue;
      if (hidden(element) || offscreenFixedRoot(element) || clipped(element, end)) continue;
      overflowRight = Math.max(overflowRight, rect.right - end, start - rect.left);
      offenders.add(element);
    }
    const overflowing = [...offenders]
      .filter((element) => !element.parentElement || !offenders.has(element.parentElement))
      .slice(0, 8)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return `${describe(element)}:${Math.round(rect.left)}..${Math.round(rect.right)}`;
      });

    const inSentence = (element: Element) => {
      let block = element.parentElement;
      while (block && getComputedStyle(block).display.startsWith("inline")) block = block.parentElement;
      return Boolean(block?.textContent?.replace(element.textContent ?? "", "").trim());
    };
    const smallTargets: string[] = [];
    if (width < breakpoint) {
      const selector = "a[href],button,[role=button],[role=switch],[role=tab],[role=checkbox],[role=radio],[role=menuitem],[role=link],input:not([type=hidden]),select,textarea,summary";
      for (const element of document.querySelectorAll(selector)) {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) continue;
        if (rect.bottom <= 0 || rect.top >= height || rect.right <= 0 || rect.left >= width) continue;
        if (hidden(element) || offscreenFixedRoot(element)) continue;
        if (element.matches(":disabled,[aria-disabled=true]")) continue;
        if (element.tagName === "A" && getComputedStyle(element).display.startsWith("inline") && inSentence(element)) continue;
        if (Math.min(rect.width, rect.height) >= floor) continue;
        smallTargets.push(`${describe(element)}:${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    }

    return {
      width,
      scrollWidth: document.documentElement.scrollWidth,
      mainOverflow: main ? Math.max(0, main.scrollWidth - main.clientWidth) : 0,
      overflowRight: Math.round(overflowRight),
      overflowing,
      smallTargets,
    };
  }, { floor: TOUCH_TARGET_FLOOR, breakpoint: TOUCH_TARGET_BREAKPOINT });
}

export function hasOverflow(finding: ResponsiveFinding) {
  return finding.scrollWidth > finding.width || finding.mainOverflow > 1 || finding.overflowing.length > 0;
}
