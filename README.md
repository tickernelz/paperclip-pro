# Paperclip Pro

Paperclip Pro is a self-hosted control plane that runs a team of AI coding agents as an organisation: an org chart, tasks and approvals, scheduled heartbeats, budgets, and an audit trail, with a Node.js server, an embedded PostgreSQL, and a React board.

It is a **hard fork** of [`paperclipai/paperclip`](https://github.com/paperclipai/paperclip), branched at upstream commit `7b7c4d417` and since diverged. It is not an upstream release and is not endorsed by Paperclip Labs, Inc. All workspace packages are renamed under the `@tickernelz/paperclip-pro` scope, the CLI binary is `paperclip-pro`, and instance state lives under `~/.paperclip-pro` instead of `~/.paperclip`, so this fork installs and runs beside an upstream instance instead of replacing it.

Report bugs in [this repository](https://github.com/tickernelz/paperclip-pro/issues), never in the upstream tracker.

## What this fork adds

| Addition | Where |
| --- | --- |
| **Built-in `omp_local` adapter.** Runs the local Oh My Pi (OMP) coding-agent CLI as a Paperclip agent runtime: server execution, CLI event formatting, model discovery through `omp models --json`, a UI transcript parser, and a startup-complete signal the run-concurrency gate reads. | [`packages/adapters/omp-local`](packages/adapters/omp-local), registered in `server/src/adapters/registry.ts` |
| **Server-hosted Paperclip MCP.** `POST /api/mcp/paperclip` exposes the Paperclip API as MCP tools generated from the OpenAPI document — 675 operations today, 18 in the `core` toolset and the rest in `extended` — selected per run with `?toolsets=`. Adapters that can mount an MCP client get the endpoint; the others get a REST fallback prompt instead of tool names that do not exist. | `server/src/routes/paperclip-mcp.ts`, `packages/mcp-server/src/generated/api-tools.json` |
| **Role-based agent authority.** An agent actor carries work authority (`work:read`, `work:issues`, `work:routines`); an agent whose role is `ceo` additionally carries company authority over agents, projects, settings, members and approvals. Every generated MCP tool is tagged `agent` or `board` and gated on the same model. | `packages/shared/src/agent-authority.ts`, `server/src/services/authorization.ts` |
| **Per-task model and thinking overrides.** A task can run on a different model or thinking level than its assignee's stored configuration, validated against the adapter's own published config schema, with optional inheritance to new or existing subtasks. No new column and no migration: it reuses `issues.assignee_adapter_overrides`. | `server/src/services/issue-run-model-override.ts`, `server/src/services/issue-model-override-inheritance.ts` |
| **Batch model/thinking changes.** Select agents in the Agents list and change the model-selection fields their adapters share. The batch is atomic: one invalid value rejects the call with 422 and writes nothing. Up to 100 agents per call. | `POST /api/agents/batch/adapter-config`, `.../preview` |
| **Local CLI run concurrency caps.** Local adapters are memory-hungry while booting; the queued-run claim point caps total local runs and simultaneous startups, and shows held-back runs as "Waiting to start". | `server/src/services/heartbeat.ts` |
| **Mobile composer and pickers.** The task and agent composers, the model/thinking picker and the New Task modal work on a phone: pickers dock above the keyboard instead of being covered by it. | `ui/src/components/task-chat/` |
| **`service restart --drain` and a live-run guard.** Restart and stop refuse while agent runs are executing unless you drain or force. A per-instance `service.env` the CLI never overwrites carries operator environment across unit rewrites. | `cli/src/commands/service.ts`, `cli/src/services/service-manager.ts` |
| **Isolated home.** `PAPERCLIP_HOME` defaults to `~/.paperclip-pro`; config, embedded PostgreSQL, logs, storage and backups all resolve under `~/.paperclip-pro/instances/<id>`. | `packages/shared/src/home-paths.ts` |
| **One lean CI and a tag-triggered release.** A single `ci.yml` (policy, typecheck, build, runner, sharded tests, E2E) and a `release.yml` that publishes the whole package set to npm when a `v*` tag is pushed. | `.github/workflows/` |

Operators: read [`docs/fork/OPERATIONS.md`](docs/fork/OPERATIONS.md).

## Install

Requirements: Node.js 24.11 or newer, `npm`, macOS/Linux/WSL2. Nothing else — the published packages ship prebuilt.

```sh
npx @tickernelz/paperclip-pro@latest install --yes
paperclip-pro onboard --yes
```

`install` resolves one exact version — the `latest` dist-tag of `@tickernelz/paperclip-pro`, or `--version` — then verifies that all 31 packages of the release exist at that exact version before it downloads anything. A half-published release is refused with the missing package names; versions are never mixed across packages. It then installs the set into `~/.paperclip-pro/cli/installs/npm/<version>`, smoke-tests the payload, and only then atomically flips `~/.paperclip-pro/cli/current` and writes the `~/.local/bin/paperclip-pro` shim. Measured on a WSL2 box: 44 s, against 11 m 38 s for the same commit through the git path.

`latest` currently points at **2026.926.1**. **Do not install 2026.926.0**: its release run left `@tickernelz/paperclip-pro-server` stuck in npm's staging queue, so that version was unusable — which is why the completeness check exists. npm's queue has since flushed, so the check no longer refuses it, but the release was never validated; use `2026.926.1` or newer.

Releases up to and including `2026.926.1` cannot bootstrap under npm 12, which changed the shape of `npm view --json` and denies dependency install scripts by default. Under npm 11 — the version Node 24.18.0 bundles — the same command works. Later releases handle both.

Pin a published version:

```sh
paperclip-pro install --version 2026.926.1 --yes
```

`--canary` follows the `canary` dist-tag, which the release workflow does not publish today; it uses `next` and `latest`.

### What an install replaces

An install or update only ever writes inside `~/.paperclip-pro/cli/` and the shim:

| Path | What happens |
| --- | --- |
| `~/.paperclip-pro/cli/installs/<npm\|git>/<id>/` | New payload directory; the two previous payloads are kept for rollback, older ones pruned |
| `~/.paperclip-pro/cli/current` | Symlink flipped atomically to the new payload |
| `~/.paperclip-pro/cli/install.json` | Install manifest, rewritten (previous records retained) |
| `~/.local/bin/paperclip-pro` | Managed shim, rewritten with the validated Node executable |
| `~/.bashrc` or `~/.zshrc` | A marked PATH block, only when `~/.local/bin` is not already on `PATH` |

Nothing under `~/.paperclip-pro/instances/` is touched: the instance database, `config.json`, `service.env`, secrets, logs, storage, backups and workspaces survive a payload switch in either direction.

`onboard --yes` writes `~/.paperclip-pro/instances/default/config.json` for trusted local loopback and starts the server on `http://127.0.0.1:3100`. An embedded PostgreSQL is created automatically. For a reachable instance, pick a bind preset:

```sh
paperclip-pro onboard --yes --bind lan
paperclip-pro onboard --yes --bind tailnet
```

### Installing an unreleased commit

The git path builds a GitHub commit from source. It needs pnpm 9.15.4, `git`, `curl`, `tar` and `corepack`, and takes minutes rather than seconds. Use it for development only:

```sh
paperclip-pro install --ref main --yes
paperclip-pro install --repo tickernelz/paperclip-pro --ref <commit-sha> --yes
```

`--repo` defaults to `tickernelz/paperclip-pro`. `--ref` cannot be combined with `--version` or `--canary`.

### Upgrade and rollback

```sh
paperclip-pro update --check
paperclip-pro update --latest
paperclip-pro update --rollback
```

`update` backs up the database first, installs the new payload, restarts the active service and validates it; a failed validation rolls the payload back automatically. `--rollback` returns to the retained previous payload instantly — it does not reverse database migrations.

## Configuration

Instance configuration lives in `~/.paperclip-pro/instances/default/config.json` and is edited with `paperclip-pro configure`, not by hand while the service runs. `paperclip-pro doctor` prints the resolved paths, and `paperclip-pro env` prints the effective environment.

Operator environment — `PATH` entries for adapter binaries, provider API keys, proxy settings — belongs in `~/.paperclip-pro/instances/default/service.env`, one `KEY=value` per line. The systemd unit sources it with `EnvironmentFile=-`, and the CLI never rewrites it, while the unit file itself is re-rendered on every CLI-driven start.

| Variable | Default | Bounds | Meaning |
| --- | --- | --- | --- |
| `PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS` | 10 | 1–64 | Total local CLI runs this controller may have running at once. Never bypassed. |
| `PAPERCLIP_MAX_CONCURRENT_LOCAL_STARTS` | 4 | 1–64 | Local CLI runs allowed to be in their startup phase at once. |
| `PAPERCLIP_LOCAL_START_WAIT_BYPASS_SEC` | 120 | 1–3600 | A queued local run that has waited this long starts anyway, ignoring the startup cap but still inside the total cap. The same window bounds the startup phase, so a hung boot cannot block the gate forever. |
| `PAPERCLIP_PDF_CHROMIUM_PATH` | unset | — | Chromium-family executable used for PDF export. `PUPPETEER_EXECUTABLE_PATH` and `CHROME_PATH` are also consulted. |
| `PORT` | 3100 | — | HTTP listen port; overrides `server.port`. |
| `PAPERCLIP_HOME` | `~/.paperclip-pro` | — | Root of all instance state. |
| `PAPERCLIP_INSTANCE_ID` | `default` | — | Selects the instance under `PAPERCLIP_HOME/instances/`. |
| `PAPERCLIP_TELEMETRY_DISABLED` / `DO_NOT_TRACK` | unset | — | Disables anonymous usage telemetry, which is on by default and off automatically when `CI=true`. |

## Running as a service

```sh
paperclip-pro service install
paperclip-pro service status
paperclip-pro service logs -f
paperclip-pro service restart --drain
```

The unit is `paperclip-pro.service` for the `default` instance and `paperclip-pro-<id>.service` otherwise; on macOS the launchd label is `ing.paperclip.paperclip-pro`. `--drain` waits for executing agent runs; without it, `stop` and `restart` refuse while runs are in flight unless forced.

Day-two operation — state layout, safe restarts, backups, admin bootstrap, public hostnames, release mechanics, sandboxed test runs — is in [`docs/fork/OPERATIONS.md`](docs/fork/OPERATIONS.md).

## Development

Node 24.18.0 and pnpm 9.15.4 (`packageManager` in `package.json`). Work in a git worktree per change; never point a development instance at `~/.paperclip-pro`.

```sh
git clone https://github.com/tickernelz/paperclip-pro.git
cd paperclip-pro
pnpm install --frozen-lockfile
pnpm dev
```

| Command | What it does |
| --- | --- |
| `pnpm dev` | API and UI in watch mode on `:3100` |
| `pnpm dev:mobile` | Serves the prebuilt UI on `:3101` and proxies `/api` to `:3100` |
| `pnpm build` | Builds every package |
| `pnpm typecheck` | Type-checks every package |
| `pnpm test` | Vitest, the default gate (no Playwright) |
| `pnpm test:e2e` | Playwright browser suite |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle migrations |

Tests and manual trials must never touch a live instance. Use an isolated data directory:

```sh
node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts test-drive --data-dir /tmp/pcpro-trial --no-browser
```

Section 8 of [`docs/fork/OPERATIONS.md`](docs/fork/OPERATIONS.md) documents the sandbox rules for suite runs. The full development guide is [`doc/DEVELOPING.md`](doc/DEVELOPING.md); installation details are in [`doc/INSTALLING.md`](doc/INSTALLING.md) and the CLI reference in [`doc/CLI.md`](doc/CLI.md).

## Release

Pushing a `v<YYYY.MDD.P>` tag triggers `.github/workflows/release.yml`, which builds once, packs each package once, publishes the set under the `next` dist-tag in dependency order, waits for npm to expose all of it, moves `latest`, and opens a GitHub release.

```sh
./scripts/tag-release.sh --dry-run
./scripts/tag-release.sh
```

`scripts/tag-release.sh` resolves the next free version, refuses a version whose tag already exists, and refuses to tag a commit whose `ci.yml` run is not green. The release job re-checks both: the tagged commit must be reachable from `origin/main` and must have a successful CI run. Reruns are idempotent, so a partial publish can be resumed. Section 9 of [`docs/fork/OPERATIONS.md`](docs/fork/OPERATIONS.md) has the dispatch inputs and the npm token setup.

## Observability

OpenTelemetry tracing activates when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; the SDK, auto-instrumentation and exporter packages are optional peer dependencies. Sentry activates with `SENTRY_DSN_BACKEND` and `SENTRY_DSN_FRONTEND`. See [`doc/observability.md`](doc/observability.md).

## Licence and attribution

MIT. Upstream work is copyright Paperclip Labs, Inc ([paperclip.ing](https://paperclip.ing)); fork modifications are copyright the paperclip-pro maintainers. Both notices are in [`LICENSE`](LICENSE).

Upstream project, for reference only — do not file fork bugs there: [`paperclipai/paperclip`](https://github.com/paperclipai/paperclip), [docs.paperclip.ing](https://docs.paperclip.ing).
