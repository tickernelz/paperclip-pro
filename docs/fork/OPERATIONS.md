# Paperclip Pro — Operations Runbook

Day-two operation of an installed Paperclip Pro instance. Every command and path
below is taken from this repository's source; the citations say where.

This fork is not on npm. Commands assume the managed shim installed by
`paperclip-pro install` is on `PATH` (`~/.local/bin/paperclip-pro`,
`cli/src/install-store.ts:85`).

## 1. Where state lives

`PAPERCLIP_HOME` defaults to `~/.paperclip-pro` and every instance path is
derived from it (`packages/shared/src/home-paths.ts:16`).

| Path | What it is | Source |
| --- | --- | --- |
| `~/.paperclip-pro/instances/<id>/` | Instance root. `<id>` defaults to `default`, overridable with `PAPERCLIP_INSTANCE_ID` or `--instance`. | `packages/shared/src/home-paths.ts:22`, `packages/shared/src/home-paths.ts:30` |
| `~/.paperclip-pro/instances/default/config.json` | Instance configuration. | `packages/shared/src/home-paths.ts:5`, `packages/shared/src/home-paths.ts:37` |
| `~/.paperclip-pro/instances/default/service.env` | Operator environment sourced by the systemd unit. Never rewritten by the CLI. | `cli/src/services/service-manager.ts:126` |
| `~/.paperclip-pro/instances/default/db/` | Embedded PostgreSQL data directory (default port `54329`). | `packages/shared/src/home-paths.ts:59`, `packages/shared/src/config-schema.ts:34` |
| `~/.paperclip-pro/instances/default/data/storage/` | File storage. | `packages/shared/src/home-paths.ts:80` |
| `~/.paperclip-pro/instances/default/data/backups/` | Database backups. | `packages/shared/src/home-paths.ts:87` |
| `~/.paperclip-pro/instances/default/logs/` | Service logs. | `packages/shared/src/home-paths.ts:66` |
| `~/.paperclip-pro/instances/default/secrets/master.key` | Secrets master key. | `packages/shared/src/home-paths.ts:73` |
| `~/.paperclip-pro/cli/` | Managed CLI payload store, atomic `current` pointer. | `cli/src/install-store.ts` |

Inspect the resolved set for a live instance:

```bash
paperclip-pro doctor
```

## 2. The service unit

On Linux the unit is `paperclip-pro.service` for the `default` instance and
`paperclip-pro-<id>.service` otherwise (`cli/src/services/service-manager.ts:130`).
On macOS the launchd label is `ing.paperclip.paperclip-pro`
(`cli/src/services/service-manager.ts:134`).

**The CLI owns the unit file.** `ensureCurrent()` re-renders and rewrites it on
every `service start`, `service restart`, and `service install`
(`cli/src/services/service-manager.ts:238`, `:261`, `:263`). Editing the unit by
hand is therefore pointless — your edit is discarded on the next CLI-driven
start.

The rendered unit hardcodes only `PAPERCLIP_SERVICE_MANAGED`,
`PAPERCLIP_INSTANCE_ID`, and `PAPERCLIP_HOME`, and sources everything else from
an optional per-instance environment file
(`cli/src/services/service-manager.ts:149`):

```
EnvironmentFile=-/home/<user>/.paperclip-pro/instances/default/service.env
```

The leading `-` makes a missing file non-fatal. **Any custom environment an
operator needs — a `PATH` carrying adapter binaries, provider API keys, proxy
settings — belongs in `service.env`, not in the unit.** Format is systemd
`EnvironmentFile` syntax, one `KEY=value` per line:

```bash
cat >> ~/.paperclip-pro/instances/default/service.env <<'EOF'
PATH=/home/<user>/.local/share/fnm/node-versions/v24.18.0/installation/bin:/usr/local/bin:/usr/bin:/bin
EOF
chmod 600 ~/.paperclip-pro/instances/default/service.env
paperclip-pro service restart --drain
```

Supervisor and health status:

```bash
paperclip-pro service status
paperclip-pro service logs -n 200
paperclip-pro service logs -f
```

## 3. Restarting safely

`service stop` and `service restart` refuse while agent runs are executing
(`cli/src/commands/service.ts:210`, `cli/src/commands/service.ts:228`,
`cli/src/services/instance-drain.ts:128`). The refusal names the live runs and
their issues.

**Preferred:** stop admitting new runs, wait for the live ones to finish, then
restart.

```bash
paperclip-pro service restart --drain
```

The drain posts to `/api/instance/task-drain`, polls `/api/instance/live-runs`
every second, prints remaining run and pending-wake counts, and restarts once
the instance is quiescent (`cli/src/services/instance-drain.ts:104`,
`cli/src/services/instance-drain.ts:141`). The default wait is 900 seconds; on
timeout it **does not restart** (`cli/src/commands/service.ts:283`,
`cli/src/services/instance-drain.ts:157`).

```bash
paperclip-pro service restart --drain --drain-timeout 1800
```

**Last resort:** interrupt live runs immediately.

```bash
paperclip-pro service restart --force
paperclip-pro service stop --force
```

Runs this server interrupts during a graceful shutdown are rescheduled rather
than held for reconciliation (`server/src/services/heartbeat.ts:14325`,
`server/src/services/legacy-execution-recovery.ts:29`), so a drained restart
does not strand issues. Native-runtime runs stay suspended.

A restart is serialized by `<instanceRoot>/hot-restart.lock`; if a restart
process died, remove the stale lock and retry
(`cli/src/commands/service.ts:71`, `cli/src/commands/service.ts:106`).

## 4. Updating from this repository

The fork publishes `@tickernelz/paperclip-pro*` to npm (section 9), so
`paperclip-pro update --latest` resolves once a release has run; `--canary`
still resolves nothing, because the fork publishes only `next` and `latest`.
To install a ref that is not released yet, reinstall from git:

```bash
paperclip-pro install --repo tickernelz/paperclip-pro --ref main --yes
paperclip-pro service restart --drain
```

`--repo` is required because it otherwise defaults to the upstream repository
(`cli/src/commands/install.ts:27`, `cli/src/commands/install.ts:143`), and
`--ref` is mandatory for a git install (`cli/src/commands/install.ts:141`).
Pass a commit SHA instead of `main` for a reproducible install; a 7-40 hex ref
is treated as pinned (`cli/src/commands/install.ts:147`).

The install downloads `codeload.github.com/<repo>/tar.gz/<sha>`, runs
`pnpm install --frozen-lockfile`, builds, packs every workspace package, installs
the tarballs into a payload directory, smoke-tests `--version`, and only then
swaps the payload into place (`cli/src/commands/install.ts:255`). A payload for a
SHA already built is reused.

Roll back to the retained previous payload:

```bash
paperclip-pro update --rollback
```

## 5. Creating a new admin account

`auth bootstrap-ceo` mints a one-time invite URL for the first instance admin
(`cli/src/index.ts:268`, `cli/src/commands/auth-bootstrap-ceo.ts:54`):

```bash
paperclip-pro auth bootstrap-ceo
```

If an admin already exists the command refuses unless you pass `--force`.
Other flags: `--expires-hours <hours>` for the invite window and `--base-url
<url>` when the printed link must use the public hostname rather than the
configured bind address:

```bash
paperclip-pro auth bootstrap-ceo --force --expires-hours 2 \
  --base-url https://paperclip.zhafron.my.id
```

The invite token is stored hashed (`cli/src/commands/auth-bootstrap-ceo.ts:10`);
the plaintext is printed once. The database URL is resolved from
`DATABASE_URL`, then `config.json`; for an embedded instance it defaults to
`postgres://paperclip:paperclip@127.0.0.1:<embeddedPostgresPort>/paperclip`
(`cli/src/commands/auth-bootstrap-ceo.ts:18`).

## 6. Public hostname

`paperclip.zhafron.my.id` is served by the `zhafron-apps` Cloudflare named
tunnel, which maps it to the local instance:

```yaml
  - hostname: paperclip.zhafron.my.id
    service: http://localhost:3100
```

That mapping lives in `~/.cloudflared/zhafron-apps.yml`. It is tunnel
configuration, not Paperclip configuration: changing the instance port means
editing both that ingress entry and `server.port` in `config.json`.

When the instance runs in authenticated/private mode, the public hostname must
also be allowed:

```bash
paperclip-pro allowed-hostname paperclip.zhafron.my.id
```

(`cli/src/index.ts:189`.)

## 7. Database backups

Automatic backups are **on by default**: hourly, retained 7 days, written to the
instance backup directory (`packages/shared/src/config-schema.ts:23`):

```
enabled: true
intervalMinutes: 60
retentionDays: 7
dir: ~/.paperclip-pro/instances/default/data/backups
```

Change them with `paperclip-pro configure --section database`. Backup health is
surfaced on the health endpoint as `database_backup_missing`,
`database_backup_stale`, `database_backup_last_failure`, and
`database_backup_check_failed` (`server/src/routes/health.ts:82`).

Take a one-off backup:

```bash
paperclip-pro db:backup
paperclip-pro db:backup --dir /some/other/place --retention-days 30 --json
```

(`cli/src/index.ts:176`.) `update` also takes a pre-update backup unless you pass
`--no-backup` (`cli/src/index.ts:100`).

Backups are `.sql.gz` dumps (`server/src/services/database-backup-health.ts:122`).
They are written inside the instance root, so a backup of the instance root is a
backup of the backups too — copy them off the box if that matters.

## 8. Running the test suite without touching the live instance

The repository's own test helpers can install services, write to
`PAPERCLIP_HOME`, and call `systemctl`. **Never run the suite with your normal
environment against a live instance.** Run it inside a disposable home with the
service managers shimmed out:

```bash
export SANDBOX=$(mktemp -d ~/Projects/.pcpro-sandbox-XXXX)
mkdir -p "$SANDBOX/home" "$SANDBOX/bin" "$SANDBOX/run"
for b in systemctl loginctl launchctl journalctl; do
  printf '#!/bin/sh\necho "SHIM $0 $*" >> %s/shim.log\nexit 0\n' "$SANDBOX" > "$SANDBOX/bin/$b"
  chmod +x "$SANDBOX/bin/$b"
done
export HOME="$SANDBOX/home"
export PAPERCLIP_HOME="$SANDBOX/paperclip"
export XDG_RUNTIME_DIR="$SANDBOX/run"
export DBUS_SESSION_BUS_ADDRESS=
export PATH="$SANDBOX/bin:$PATH"

pnpm test
```

Why each piece is needed:

- `PAPERCLIP_HOME` is the single root every instance path derives from
  (`packages/shared/src/home-paths.ts:16`), so redirecting it redirects config,
  database, storage, backups, and logs in one move.
- `HOME` is redirected because the managed install store and the shim path are
  resolved from it (`cli/src/install-store.ts:85`), and the systemd unit is
  written under the user's home.
- The `systemctl`/`launchctl` shims catch anything that still tries to touch a
  real service manager; `$SANDBOX/shim.log` records every such attempt. An
  empty log is the proof that nothing reached the supervisor.
- `XDG_RUNTIME_DIR` and an empty `DBUS_SESSION_BUS_ADDRESS` stop a stray
  user-bus connection from reaching the real session.

Afterwards, confirm the live instance was untouched and clean up:

```bash
cat "$SANDBOX/shim.log" 2>/dev/null || echo 'no supervisor calls'
systemctl --user is-active paperclip-pro.service
rm -rf "$SANDBOX"
```

For a manual end-to-end instance instead of the unit suite, use the built-in
isolated mode, which never installs a service:

```bash
paperclip-pro test-drive --data-dir /tmp/pcpro-trial --no-browser
```

`--data-dir` isolates state from `~/.paperclip-pro` (`cli/src/index.ts:63`).

## 9. Releasing to npm

One workflow does the whole release: **Release**
(`.github/workflows/release.yml`), `workflow_dispatch` only, one job, no
tests — the PR/main CI owns those. It builds once, packs each package once,
publishes the packed tarballs in dependency order under the `next` dist-tag,
waits for npm to expose the whole set, moves `latest` onto it, then tags the
release commit and opens a GitHub release with notes generated since the
previous `v*` tag.

Preview first, then publish:

```bash
gh workflow run release.yml --repo tickernelz/paperclip-pro --ref main \
  -f dry_run=true -f auth=token -f version=

gh workflow run release.yml --repo tickernelz/paperclip-pro --ref main \
  -f dry_run=false -f auth=token -f version=
```

Inputs:

- `version` — empty resolves the UTC date slot `YYYY.MDD` plus the next patch
  not already published for `@tickernelz/paperclip-pro`, so a same-day rerun
  never collides. Pass an explicit `YYYY.MDD.P` to pin it.
- `dry_run` — `true` previews every step and contacts npm only for read-only
  checks.
- `auth` — `token` uses the `NPM_TOKEN` repository secret; `oidc` uses npm
  trusted publishing. Keep `token` until every package has a trusted publisher
  configured, and note that npm OIDC does not authenticate
  `npm dist-tag add`, so the `latest` promotion always needs the token.

The run is idempotent and resumable: a package version already on npm is
skipped, a dist-tag already pointing at the version is left alone, and an
existing tag or GitHub release is not recreated. Rerunning the same version
after a partial failure finishes the set.

The same script runs locally:

```bash
./scripts/release.sh --print-version
./scripts/release.sh --dry-run
```

One-time owner setup before the first publish:

1. Create an npm granular access token with read and write on the
   `@tickernelz` scope, `All packages` (no package exists yet to select), and
   bypass-2FA so CI can publish non-interactively.
2. Store it as the `NPM_TOKEN` repository secret.
3. After the first successful publish, configure a trusted publisher on each
   package (GitHub Actions, `tickernelz/paperclip-pro`, workflow
   `release.yml`, no environment). That step needs interactive 2FA.
4. Afterwards `auth=oidc` covers the publishes; keep the token for the
   `latest` promotion.

## 10. Local CLI run concurrency

Local CLI adapters (`codex_local`, `omp_local`, `pi_local`, ...) are memory-hungry
while they boot: each child loads its extensions, plugins and MCP servers before
it can accept a turn. On 2026-09-25 nine `omp` children started at once, exhausted
WSL memory and stalled the server for 64 seconds. The instance therefore applies
two caps at the queued-run claim point (`server/src/services/heartbeat.ts`,
`startNextQueuedRunForAgent`), and the board shows anything held back as
"Waiting to start".

| Variable | Default | Bounds | Meaning |
| --- | --- | --- | --- |
| `PAPERCLIP_MAX_CONCURRENT_LOCAL_RUNS` | 10 | 1–64 | Total local CLI runs this controller may have running at once. Never bypassed. |
| `PAPERCLIP_MAX_CONCURRENT_LOCAL_STARTS` | 4 | 1–64 | Local CLI runs allowed to be in their startup phase at once. |
| `PAPERCLIP_LOCAL_START_WAIT_BYPASS_SEC` | 120 | 1–3600 | A queued local run that has waited this long starts anyway, ignoring the startup cap but still inside the total cap. The same window bounds the startup phase: a run that has not reported its startup signal within it stops counting as starting, so a hung boot cannot block the gate forever. |

A run counts as *starting* from the moment it is claimed until its adapter
declares the child booted. An adapter declares this with the optional
`isStartupComplete(stdoutLine)` hook on its `ServerAdapterModule`; an adapter
that does not implement it is counted as started on its child's first stdout
chunk.

`omp_local` implements it (`packages/adapters/omp-local/src/server/parse.ts`,
`isOmpStartupComplete`) as the first JSON line whose `type` is an agent/turn/
message/tool/result event — `agent_start` in practice. Its `{"type":"session"}`
header only means the process is alive: measured on production runs it lands
2.4–9.0 s after `adapter.invoke`, with `agent_start` a further 2.5–6.0 s later,
so extension and MCP loading can still be in flight when the header prints.
Progress notices such as `Still starting after 10s — phase: loadExtensions` go
to **stderr** and never release the gate; on 2026-09-25 a slow MCP boot printed
them at 00:42:04.766 and 00:42:23.716, with `session` at 00:42:30.059 and
`agent_start` only at 00:42:35.617.

Queued local runs are re-evaluated when a local run finishes, when a starting run
reports its startup signal, and on a timer armed for the bypass deadline; the
30-second heartbeat scheduler tick (`HEARTBEAT_SCHEDULER_INTERVAL_MS`) is the
backstop.

## 11. Paperclip MCP tools in `omp_local` runs

Every `omp_local` run declares one extra MCP server, `paperclip`, through a
per-run `--extension <tmpdir>` package holding a single `.mcp.json`
(`packages/adapters/omp-local/src/server/paperclip-mcp.ts`). The extension is
appended, so the operator's own `~/.omp/agent/mcp.json` servers keep loading.

By default the entry is `type: http` and points at the server-hosted endpoint
`$PAPERCLIP_API_URL/mcp/paperclip?toolsets=core`, with
`Authorization: Bearer ${PAPERCLIP_API_KEY}` (an env reference, never a literal)
and `X-Paperclip-Run-Id`. That costs no process and no extra memory per run.
`paperclipMcpTransport: stdio` is the fallback: it spawns the bundled
`paperclip-mcp-server` with the run's identity in its env. The adapter config
also exposes `paperclipMcp` (default on) and `paperclipMcpToolsets`
(default `core`).

MCP is the agents' only path to Paperclip, so the adapter completes an MCP
`initialize` before it spawns OMP: a POST against the endpoint with a 5 s
timeout, or the handshake with the binary under the stdio fallback. Downtime
fails the run with `errorCode: paperclip_mcp_unavailable`, a 401/403 with
`errorCode: paperclip_mcp_credential_rejected`, and the unavailable code is
raised again when OMP itself reports `MCP server "paperclip" failed to
connect`. Turning `paperclipMcp` off logs a warning on the run's stderr: that
agent has no Paperclip tools.

Why the endpoint is the default: measured on 2026-09-25 (WSL, Node 24.18.0,
`core` toolset, 3 probes each) the stdio fallback costs a whole process per run.

| Measurement | No MCP server | Bundled stdio server |
| --- | --- | --- |
| omp spawn to `agent_start` | 1842 / 1862 / 2002 ms | 2406 / 2458 / 2530 ms |
| `paperclip-mcp-server` RSS at steady state | — | 127.4 / 127.4 / 127.3 MB |

That is about 0.6 s of run startup and ~127 MB resident for the life of the run
(61 `core` tools, `tools/list` 35 kB) — most of it a floor: a bare Node 24
process is 43 MB and the MCP SDK with Zod adds about 35 MB before any Paperclip
code, and the same server measured 191–193 MB before its tool definitions were
filtered per toolset. Ten concurrent local runs would therefore hold about
1.3 GB in stdio servers alone, which is why the HTTP endpoint is the default and
the stdio path is only a fallback.

OMP connects its MCP servers during startup, before `agent_start`, so the tools
are in the tool list for the first model turn; the connect failure warning also
lands before `agent_start`, which is why the adapter can stop the run before a
turn is spent.

## Security: emptying allowedHostnames does not lock out the public host

`auth.publicBaseUrl` is always folded into the hostname allow-list (`server/src/config.ts`), so `https://paperclip.zhafron.my.id` stays reachable even when `server.allowedHostnames` is empty. On 2026-09-24 a sign-up POST through the tunnel succeeded with `auth.disableSignUp=false` and `allowedHostnames=[]` for exactly this reason. Separately, the guard used to trust a client-supplied `X-Forwarded-Host`; that is fixed, and the header is now honoured only when `TRUST_PROXY` declares the peer trusted.

Keep `auth.disableSignUp=true` whenever the tunnel is up. To add a person:

1. Use the invite flow: `paperclip-pro auth bootstrap-ceo --force --base-url https://paperclip.zhafron.my.id` for a new instance admin, or a company invite from the board.
2. If sign-up must be opened briefly, first remove the `paperclip.zhafron.my.id` ingress from `~/.cloudflared/zhafron-apps.yml` and restart `zhafron-apps-tunnel.service`, then restore it after `disableSignUp` is back to `true`.

Verify the seal after any auth change:

```bash
curl -s -X POST https://paperclip.zhafron.my.id/api/auth/sign-up/email \
  -H 'Content-Type: application/json' -H 'Origin: https://paperclip.zhafron.my.id' \
  -d '{"name":"probe","email":"probe@example.invalid","password":"x-probe-x-probe"}'
```

Expected: `400 EMAIL_PASSWORD_SIGN_UP_DISABLED`.

## CLI login for board operations

`paperclip-pro service restart --drain` and other board calls need a board credential. Run `paperclip-pro auth login --instance-admin` and approve the printed URL while signed in to the board. Approval is rejected unless the request carries a trusted browser origin, so approve it from the board in a browser, not with a bare API call.
