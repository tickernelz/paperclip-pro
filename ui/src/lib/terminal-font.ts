const NERD_FONT_FAMILIES = [
  "MesloLGS NF",
  "MesloLGS Nerd Font Mono",
  "CaskaydiaCove Nerd Font Mono",
  "CaskaydiaMono Nerd Font",
  "JetBrainsMono Nerd Font",
  "FiraCode Nerd Font Mono",
  "Symbols Nerd Font Mono",
];

export const TERMINAL_ICON_WEB_FONT_FAMILY = "Paperclip Symbols Nerd Font Mono";

const TERMINAL_ICON_PROBE_TEXT = "\uE0A0\uE0B0\uF017\uF07B\uF313";

const DEFAULT_MONOSPACE_FALLBACK = "Menlo, Monaco, Consolas, Liberation Mono, monospace";

export function terminalFontFamily(fallback: string = DEFAULT_MONOSPACE_FALLBACK): string {
  return [...NERD_FONT_FAMILIES, TERMINAL_ICON_WEB_FONT_FAMILY, fallback].join(", ");
}

function isTerminalIconWebFont(face: FontFace): boolean {
  return face.family.replace(/["']/g, "") === TERMINAL_ICON_WEB_FONT_FAMILY;
}

function documentFonts(): FontFaceSet | undefined {
  return typeof document === "undefined" ? undefined : document.fonts;
}

/** Starts the bundled icon font only when no earlier font draws the prompt icons; null when there is nothing to wait for. */
export function loadTerminalIconFont(fontFamily: string): Promise<void> | null {
  const fonts = documentFonts();
  if (!fonts) return null;
  const face = Array.from(fonts).find(isTerminalIconWebFont);
  if (!face) return null;
  if (face.status === "unloaded") {
    const context = document.createElement("canvas").getContext("2d");
    if (context) {
      context.font = `16px ${fontFamily}`;
      context.measureText(TERMINAL_ICON_PROBE_TEXT);
    }
  }
  if (face.status !== "loading") return null;
  return face.loaded.then(() => undefined, () => undefined);
}

export function onTerminalIconFontLoaded(listener: () => void): () => void {
  const fonts = documentFonts();
  if (!fonts) return () => {};
  const handle = (event: FontFaceSetLoadEvent) => {
    if (event.fontfaces.some(isTerminalIconWebFont)) listener();
  };
  fonts.addEventListener("loadingdone", handle);
  return () => fonts.removeEventListener("loadingdone", handle);
}
