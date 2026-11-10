---
title: Adapters Overview
summary: What adapters are and how they connect agents to Wardmote
---

Adapters are the bridge between Wardmote's orchestration layer and agent runtimes. Each adapter knows how to invoke a specific type of AI agent and capture its results.

## How Adapters Work

When a heartbeat fires, Wardmote:

1. Looks up the agent's `adapterType` and `adapterConfig`
2. Calls the adapter's `execute()` function with the execution context
3. The adapter spawns or calls the agent runtime
4. The adapter captures stdout, parses usage/cost data, and returns a structured result

## Built-in Adapters

| Adapter | Type Key | Description |
|---------|----------|-------------|
| OMP | `omp_local` | Runs the OMP coding agent. This is the only agent runtime offered when you create an agent. |
| Wardmote Runner | `wardmote_runner` | Experimental native runner, enabled per instance. |
| [Process](/adapters/process) | `process` | Executes arbitrary shell commands. Kept on the server for existing agents; not selectable in the UI. |
| [HTTP](/adapters/http) | `http` | Sends webhooks to external agents. Kept on the server for existing agents; not selectable in the UI. |

## Removed adapters

Earlier releases shipped other built-in adapters (`claude_local`, `codex_local`,
`cursor`, `cursor_cloud`, `gemini_local`, `grok_local`, `hermes_local`,
`hermes_gateway`, `kimi_local`, `opencode_local`, `pi_local`,
`openclaw_gateway`, and the earlier `acpx_local`). Their packages are gone.
An agent whose `adapterType` still names one of them keeps its data, is shown
as removed, and cannot run or be selected until you switch it to `omp_local`.

## External Adapters

You can build and distribute adapters as standalone packages — no changes to Wardmote's source code required. External adapters are loaded at startup via the plugin system.

```sh
# Install from npm via API
curl -X POST http://localhost:3102/api/adapters \
  -d '{"packageName": "my-paperclip-adapter"}'

# Or link from a local directory
curl -X POST http://localhost:3102/api/adapters \
  -d '{"localPath": "/home/user/my-adapter"}'
```

See [External Adapters](/adapters/external-adapters) for the full guide.

## Adapter Architecture

Each adapter is a package with modules consumed by three registries:

```
my-adapter/
  src/
    index.ts            # Shared metadata (type, label, models)
    server/
      execute.ts        # Core execution logic
      parse.ts          # Output parsing
      test.ts           # Environment diagnostics
    ui-parser.ts        # Self-contained UI transcript parser (for external adapters)
    cli/
      format-event.ts   # Terminal output for `wardmote run --watch`
```

| Registry | What it does | Source |
|----------|-------------|--------|
| **Server** | Executes agents, captures results | `createServerAdapter()` from package root |
| **UI** | Renders run transcripts, provides config forms | `ui-parser.js` (dynamic) or static import (built-in) |
| **CLI** | Formats terminal output for live watching | Static import |

## UI Parser Contract

External adapters can ship a self-contained UI parser that tells the Wardmote web UI how to render their stdout. Without it, the UI uses a generic shell parser. See the [UI Parser Contract](/adapters/adapter-ui-parser) for details.
