const NERD_FONT_FAMILIES = [
  "MesloLGS NF",
  "MesloLGS Nerd Font Mono",
  "CaskaydiaCove Nerd Font Mono",
  "CaskaydiaMono Nerd Font",
  "JetBrainsMono Nerd Font",
  "FiraCode Nerd Font Mono",
  "Symbols Nerd Font Mono",
];

const DEFAULT_MONOSPACE_FALLBACK = "Menlo, Monaco, Consolas, Liberation Mono, monospace";

export function terminalFontFamily(fallback: string = DEFAULT_MONOSPACE_FALLBACK): string {
  return [...NERD_FONT_FAMILIES, fallback].join(", ");
}
