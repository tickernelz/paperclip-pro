export interface NavItemProbe {
  id: string;
  expect: "active" | "rest";
  state: string;
  ariaCurrent: string | null;
  rail: boolean;
  surface: string;
  row: string;
  marker: string | null;
  text: number | null;
  icon: number | null;
  markerVsRow: number | null;
  markerVsSurface: number | null;
  rowVsSurface: number;
}

export function probeSidebarNav(state: string): NavItemProbe[] {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  type Rgba = [number, number, number, number];
  const rgba = (color: string): Rgba => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000";
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    const data = context.getImageData(0, 0, 1, 1).data;
    return [data[0] / 255, data[1] / 255, data[2] / 255, data[3] / 255];
  };
  const over = (top: Rgba, bottom: Rgba): Rgba => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1) as Rgba;
  const linear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const luminance = (c: Rgba) => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
  const ratio = (a: Rgba, b: Rgba) => {
    const x = luminance(a);
    const y = luminance(b);
    return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100;
  };
  const hex = (c: Rgba) => "#" + c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  const backgroundOf = (el: Element, includeSelf: boolean): Rgba => {
    const chain: Element[] = [];
    for (let node: Element | null = includeSelf ? el : el.parentElement; node; node = node.parentElement) chain.push(node);
    let color: Rgba = [1, 1, 1, 1];
    for (const node of chain.reverse()) {
      const fill = rgba(getComputedStyle(node).backgroundColor);
      if (fill[3] > 0) color = over(fill, color);
    }
    return color;
  };
  const items: NavItemProbe[] = [];
  for (const host of document.querySelectorAll<HTMLElement>("[data-nav-item]")) {
    const link = host.querySelector<HTMLAnchorElement>("a")!;
    const surface = backgroundOf(link, false);
    const row = backgroundOf(link, true);
    const before = getComputedStyle(link, "::before");
    const markerFill = rgba(before.backgroundColor);
    const hasMarker = before.content !== "none" && markerFill[3] > 0 && parseFloat(before.width) > 0 && parseFloat(before.height) > 0;
    const marker = hasMarker ? over(markerFill, row) : null;
    const label = [...link.querySelectorAll("span")].find((span) => span.textContent?.trim() && !span.querySelector("span")) ?? link;
    const rail = label.getBoundingClientRect().width === 0;
    const ink = rgba(getComputedStyle(label).color);
    const svg = link.querySelector("svg");
    const iconInk = svg ? rgba(getComputedStyle(svg).color) : null;
    const iconBackdrop = svg ? backgroundOf(svg, false) : row;
    items.push({
      id: host.dataset.navItem!,
      expect: host.dataset.navExpect as "active" | "rest",
      state,
      ariaCurrent: link.getAttribute("aria-current"),
      rail,
      surface: hex(surface),
      row: hex(row),
      marker: marker ? hex(marker) : null,
      text: rail ? null : ratio(over(ink, row), row),
      icon: iconInk ? ratio(over(iconInk, iconBackdrop), iconBackdrop) : null,
      markerVsRow: marker ? ratio(marker, row) : null,
      markerVsSurface: marker ? ratio(marker, surface) : null,
      rowVsSurface: ratio(row, surface),
    });
  }
  return items;
}
