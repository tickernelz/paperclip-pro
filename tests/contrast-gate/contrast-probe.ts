export interface ContrastText {
  text: string;
  fg: string;
  bg: string;
  ratio: number;
  size: number;
  weight: number;
}

export interface ContrastItem {
  id: string;
  state: string;
  minText: number | null;
  large: boolean;
  boundary: number | null;
  focusable: boolean;
  focusRing: number | null;
  texts: ContrastText[];
}

export function probeRenderedContrast(state: string): ContrastItem[] {
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
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const hex = (c: Rgba) => "#" + c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  const chain = (el: Element) => {
    const list: Element[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) list.push(node);
    return list;
  };
  const effectiveBackground = (el: Element, skipSelf: boolean): Rgba => {
    let color = rgba(getComputedStyle(document.documentElement).backgroundColor);
    if (color[3] === 0) color = [1, 1, 1, 1];
    for (const node of chain(el).reverse()) {
      if (skipSelf && node === el) continue;
      const style = getComputedStyle(node);
      const fill = rgba(style.backgroundColor);
      if (fill[3] > 0) color = over([fill[0], fill[1], fill[2], fill[3] * parseFloat(style.opacity)], color);
    }
    return color;
  };
  const opacityOf = (el: Element) => chain(el).reduce((total, node) => total * parseFloat(getComputedStyle(node).opacity), 1);
  const round = (value: number) => Math.round(value * 100) / 100;
  const splitShadows = (value: string) => {
    const parts: string[] = [];
    let depth = 0;
    let current = "";
    for (const char of value) {
      if (char === "(") depth++;
      else if (char === ")") depth--;
      if (char === "," && depth === 0) {
        parts.push(current);
        current = "";
      } else current += char;
    }
    parts.push(current);
    return parts.map((part) => part.trim()).filter(Boolean);
  };

  const items: ContrastItem[] = [];
  for (const host of document.querySelectorAll<HTMLElement>("[data-gallery-item]")) {
    const id = host.dataset.galleryItem!;
    const textSurface = host.dataset.galleryKind === "text";
    const graphic = host.dataset.galleryKind === "graphic";
    const el = textSurface || graphic || host.matches("a, button, [role=switch], [role=group]") ? host : host.querySelector<HTMLElement>("a, button") ?? host;
    const focusable = !textSurface && el.matches("button:not([disabled]), a[href]");
    const style = getComputedStyle(el);
    const opacity = opacityOf(el);
    const background = effectiveBackground(el, false);
    const outer = effectiveBackground(el, true);
    const texts: ContrastText[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const parent = node.parentElement;
      if (!text || !parent) continue;
      const parentStyle = getComputedStyle(parent);
      if (parentStyle.position === "absolute" && parentStyle.clipPath !== "none") continue;
      const own = rgba(parentStyle.color);
      const parentBackground = effectiveBackground(parent, false);
      const fg = over([own[0], own[1], own[2], own[3] * opacityOf(parent)], parentBackground);
      texts.push({ text: text.slice(0, 28), fg: hex(fg), bg: hex(parentBackground), ratio: round(ratio(fg, parentBackground)), size: parseFloat(parentStyle.fontSize), weight: Number(parentStyle.fontWeight) });
    }
    let iconRatio: number | null = null;
    const icon = el.querySelector("svg");
    if (icon && texts.length === 0) {
      const paints = graphic ? [...icon.querySelectorAll("circle, path")].map((shape) => getComputedStyle(shape).fill) : [getComputedStyle(icon).color];
      iconRatio = Math.min(...paints.map((paint) => {
        const own = rgba(paint);
        return round(ratio(over([own[0], own[1], own[2], own[3] * opacity], background), background));
      }));
    }
    const exempt = textSurface || graphic || /\.(ghost|link)(\.|$)|navitem|segmented\.item(?!\.on)|tabs\.(default\.trigger(?!\.on)|line\.trigger)/.test(id);
    let boundary: number | null = null;
    if (!exempt) {
      const fill = rgba(style.backgroundColor);
      const border = rgba(style.borderTopColor);
      const fillRatio = fill[3] > 0 ? ratio(background, outer) : 1;
      const borderRatio = parseFloat(style.borderTopWidth) > 0 && border[3] > 0 ? ratio(over([border[0], border[1], border[2], border[3] * opacity], outer), outer) : 1;
      boundary = round(Math.max(fillRatio, borderRatio));
    }
    let focusRing: number | null = null;
    if (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) {
      const ring = rgba(style.outlineColor);
      if (ring[3] > 0) focusRing = round(ratio(over(ring, outer), outer));
    }
    if (focusRing === null && style.boxShadow !== "none") {
      for (const shadow of splitShadows(style.boxShadow)) {
        const color = shadow.match(/(?:rgba?|oklab|oklch|lab|lch|color|hsla?)\([^)]*\)|#[0-9a-f]{3,8}\b/i)?.[0];
        const lengths = shadow.replace(color ?? "", "").trim().split(/\s+/).filter((part) => /px$/.test(part)).map(parseFloat);
        const spread = lengths[3] ?? 0;
        const blur = lengths[2] ?? 0;
        if (!color || (spread <= 0 && blur <= 0)) continue;
        const ring = rgba(color);
        if (ring[3] === 0) continue;
        const measured = round(ratio(over(ring, outer), outer));
        focusRing = focusRing === null ? measured : Math.max(focusRing, measured);
      }
    }
    const minText = texts.length ? Math.min(...texts.map((entry) => entry.ratio)) : iconRatio;
    const large = texts.length > 0 && texts.every((entry) => entry.size >= 24 || (entry.size >= 18.66 && entry.weight >= 700));
    items.push({ id, state, minText, large, boundary, focusable, focusRing, texts });
  }
  return items;
}
