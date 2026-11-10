# Plugin Authoring Smoke Example

A Wardmote plugin

## Development

```bash
pnpm install
pnpm dev            # watch builds
pnpm dev:ui         # local dev server with hot-reload events
pnpm test
```

## Install Into Wardmote

```bash
npx @tickernelz/wardmote plugin install ./
```

## Build Options

- `pnpm build` uses esbuild presets from `@tickernelz/wardmote-plugin-sdk/bundlers`.
- `pnpm build:rollup` uses rollup presets from the same SDK.
