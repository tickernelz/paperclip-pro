# Bundled UI Fonts

Paperclip bundles Inter for the board UI so screenshots and packaged installs use
the same sans-serif text stack without relying on host font packages. It also
bundles Symbols Nerd Font Mono as the Terminal's icon fallback, so shell prompt
icons render on machines without a Nerd Font installed.

## Inter

- Upstream project: https://github.com/rsms/inter
- Version: v4.1
- Source files:
  - https://raw.githubusercontent.com/rsms/inter/v4.1/docs/font-files/InterVariable.woff2
  - https://raw.githubusercontent.com/rsms/inter/v4.1/docs/font-files/InterVariable-Italic.woff2
- License: SIL Open Font License 1.1
- License text: https://github.com/rsms/inter/blob/v4.1/LICENSE.txt

Redistribution note: Inter is redistributed under the SIL Open Font License 1.1.
The bundled WOFF2 files are included unmodified from the upstream v4.1 release.

## Symbols Nerd Font Mono

- Upstream project: https://github.com/ryanoasis/nerd-fonts
- Version: v3.5.1
- Source archive: https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/NerdFontsSymbolsOnly.tar.xz
  (SHA-256 `01172f37db8543edb102e5cb5c64101c9f4686630804d49b419aa07b23a69996`)
- Source file: `SymbolsNerdFontMono-Regular.ttf`
  (SHA-256 `fe471e538392f51910faab985fa8e192a39dd3426125edd15b71b3680df0e749`)
- Bundled file: `SymbolsNerdFontMono-v3.5.1.woff2`
  (SHA-256 `b9e4e6812ea40d1a4679ecc349a74d38792acc8382f235c30b69a820bfef4109`)
- Conversion: `uvx --from 'fonttools[woff]==4.68.0' fonttools ttLib.woff2 compress -o SymbolsNerdFontMono-v3.5.1.woff2 SymbolsNerdFontMono-Regular.ttf`
  (brotli 1.2.1); glyphs and tables are unchanged, only the container is WOFF2.
- License: MIT, `NerdFonts-LICENSE` (copied from the archive). The icon sets
  inside the font keep their own licenses, listed in `NerdFonts-README.md`
  (copied from the archive).

The font is declared with a `unicode-range` limited to its Private Use Area
glyphs and sits after the locally installed Nerd Fonts in the Terminal font
list, so browsers download it only on the Terminal page and only when no
installed font supplies those icons.
