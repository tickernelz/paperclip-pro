# Mobile task chat shell

Run from the repository root:

```sh
pnpm exec playwright test --config tests/mobile-shell/playwright.config.ts
```

The suite runs in **WebKit** with `devices['iPhone 13']`, because the composer
and picker regressions it covers were reported on iOS Safari and on the iOS
home-screen PWA, not in Chromium. It starts an isolated Vite server on port 4198
and needs no database, credentials, or running agents.

`ui/tests/mobile-chat-shell.html` mounts `ui/src/fixtures/MobileChatShellHarness.tsx`,
which renders the shipped mobile shell seams: `useMobileNavAutoHide`,
`useComposerDockReserve`, `useMobileViewportInsets`, `composerDockClassName`,
`TaskChatWindowScroll`, `MobilePickerSheetHeader`, `InlineEntitySelector` and
`SearchableSelect`, against the real `index.css`.

Harness query parameters:

| Parameter | Effect |
| --- | --- |
| `legacyNav=1` | Reproduces the pre-fix auto-hiding nav that retuned `<main>`'s bottom padding and the composer offset mid-scroll. |
| `legacyPicker=1` | Reproduces the pre-fix picker that opened every field at once outside the bottom-sheet rules. |
| `footerRows=1` | Renders two placeholder footer rows in the sheet to check the height budget still holds. |
| `safeArea=<px>` | Overrides `--sz-safe-bottom` and the derived dock tokens to emulate the iOS home indicator. |

The two `legacy*` cases are in-suite negative controls: they assert the old
behaviour is still reproducible and measurably different, so a regression in the
docking offset or the sheet height cap cannot pass silently.

Emulated iOS conditions: touch input and mobile viewport via the WebKit iPhone 13
profile, software keyboard via a `visualViewport` resize, standalone PWA via a
full-height 390x844 viewport plus a `(display-mode: standalone)` media stub, and
the home indicator via the `safeArea` parameter. A real device still owns rubber
band overscroll and the dynamic URL bar.
