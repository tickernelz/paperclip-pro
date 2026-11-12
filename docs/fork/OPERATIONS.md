# Wardmote — Operations Runbook

Day-two operation of an installed Wardmote instance. Every command and path
below is taken from this repository's source; the citations say where.

Wardmote is published on npm as `@tickernelz/wardmote`. Commands assume the
managed shim installed by `wardmote install` is on `PATH`
(`~/.local/bin/wardmote`, `cli/src/install-store.ts:77`).

## 1. Where state lives

`WARDMOTE_HOME` defaults to `~/.wardmote` and every instance path is
derived from it (`packages/shared/src/home-paths.ts:16`).

| Path | What it is | Source |
| --- | --- | --- |
| `~/.wardmote/instances/<id>/` | Instance root. `<id>` defaults to `default`, overridable with `WARDMOTE_INSTANCE_ID` or `--instance`. | `packages/shared/src/home-paths.ts:22`, `packages/shared/src/home-paths.ts:30` |
| `~/.wardmote/instances/default/config.json` | Instance configuration. | `packages/shared/src/home-paths.ts:5`, `packages/shared/src/home-paths.ts:37` |
| `~/.wardmote/instances/default/service.env` | Operator environment sourced by the systemd unit. Never rewritten by the CLI. | `cli/src/services/service-manager.ts:126` |
| `~/.wardmote/instances/default/db/` | Embedded PostgreSQL data directory (default port `54329`). | `packages/shared/src/home-paths.ts:59`, `packages/shared/src/config-schema.ts:34` |
| `~/.wardmote/instances/default/data/storage/` | File storage. | `packages/shared/src/home-paths.ts:80` |
| `~/.wardmote/instances/default/data/backups/` | Database backups. | `packages/shared/src/home-paths.ts:87` |
| `~/.wardmote/instances/default/logs/` | Service logs. | `packages/shared/src/home-paths.ts:66` |
| `~/.wardmote/instances/default/secrets/master.key` | Secrets master key. | `packages/shared/src/home-paths.ts:73` |
| `~/.wardmote/cli/` | Managed CLI payload store, atomic `current` pointer. | `cli/src/install-store.ts` |

Inspect the resolved set for a live instance:

```bash
wardmote doctor
```

## 2. The service unit

On Linux the unit is `wardmote.service` for the `default` instance and
`wardmote-<id>.service` otherwise (`cli/src/services/service-manager.ts:133`).
On macOS the launchd label is `com.tickernelz.wardmote`
(`cli/src/services/service-manager.ts:137`).

**The CLI owns the unit file.** `ensureCurrent()` re-renders and rewrites it on
every `service start`, `service restart`, and `service install`
(`cli/src/services/service-manager.ts:238`, `:261`, `:263`). Editing the unit by
hand is therefore pointless — your edit is discarded on the next CLI-driven
start.

The rendered unit hardcodes only `WARDMOTE_SERVICE_MANAGED`,
`WARDMOTE_INSTANCE_ID`, and `WARDMOTE_HOME`, and sources everything else from
an optional per-instance environment file
(`cli/src/services/service-manager.ts:149`):

```
EnvironmentFile=-/home/<user>/.wardmote/instances/default/service.env
```

The leading `-` makes a missing file non-fatal. **Any custom environment an
operator needs — a `PATH` carrying adapter binaries, provider API keys, proxy
settings — belongs in `service.env`, not in the unit.** Format is systemd
`EnvironmentFile` syntax, one `KEY=value` per line:

```bash
cat >> ~/.wardmote/instances/default/service.env <<'EOF'
PATH=/home/<user>/.local/share/fnm/node-versions/v24.18.0/installation/bin:/usr/local/bin:/usr/bin:/bin
EOF
chmod 600 ~/.wardmote/instances/default/service.env
wardmote service restart --drain
```

The service process appends `~/.local/bin` and `~/.bun/bin` to whatever `PATH`
it inherits (systemd or launchd default, or `service.env`) when they are absent,
so an `omp` installed by `curl -fsSL https://omp.sh/install | sh` or by bun is
found without a `service.env` entry. Directories already on `PATH` keep their
position.

Memory protection in the unit: `OOMPolicy=continue` (the server stays up when the
kernel kills a run process), `OOMScoreAdjust=0`, `MemoryHigh=infinity`,
`MemoryMax=62%`, and `MemorySwapMax=25%` of physical memory. `MemoryHigh` is
deliberately unset: it throttles every task in the cgroup, server and embedded
Postgres included, and about a quarter of the sampled minutes sat above 55%.
Set it only from measured data (the shadow memory-gate log plus `memory.events`
`high`). Run children are
raised to `oom_score_adj` 500 (`WARDMOTE_RUN_OOM_SCORE_ADJ`), so the kernel
kills a run before the server. A user unit cannot lower `OOMScoreAdjust` below
the user manager's own value. Override a limit in `service.env` with
`WARDMOTE_SERVICE_MEMORY_HIGH`, `WARDMOTE_SERVICE_MEMORY_MAX`,
`WARDMOTE_SERVICE_MEMORY_SWAP_MAX` (`infinity`, `NN%`, or a non-zero byte count with
`K`/`M`/`G`/`T`; `0` is accepted only for `SWAP_MAX`) and `WARDMOTE_SERVICE_OOM_SCORE_ADJUST` (-1000 to 1000); the
CLI rewrites the unit on the next `service start` or `restart`, and a malformed
value fails those commands instead of being ignored; `service stop` still stops
the service.

Supervisor and health status:

```bash
wardmote service status
wardmote service logs -n 200
wardmote service logs -f
```

## 3. Restarting safely

`service stop` and `service restart` refuse while agent runs are executing
(`cli/src/commands/service.ts:210`, `cli/src/commands/service.ts:228`,
`cli/src/services/instance-drain.ts:128`). The refusal names the live runs and
their issues.

**Preferred:** stop admitting new runs, wait for the live ones to finish, then
restart.

```bash
wardmote service restart --drain
```

The drain posts to `/api/instance/task-drain`, polls `/api/instance/live-runs`
every second, prints remaining run and pending-wake counts, and restarts once
the instance is quiescent (`cli/src/services/instance-drain.ts:104`,
`cli/src/services/instance-drain.ts:141`). The default wait is 900 seconds; on
timeout it **does not restart** (`cli/src/commands/service.ts:283`,
`cli/src/services/instance-drain.ts:157`).

```bash
wardmote service restart --drain --drain-timeout 1800
```

**Last resort:** interrupt live runs immediately.

```bash
wardmote service restart --force
wardmote service stop --force
```

Runs this server interrupts during a graceful shutdown are rescheduled rather
than held for reconciliation (`server/src/services/heartbeat.ts:14325`,
`server/src/services/legacy-execution-recovery.ts:29`), so a drained restart
does not strand issues. Native-runtime runs stay suspended.

A restart is serialized by `<instanceRoot>/hot-restart.lock`; if a restart
process died, remove the stale lock and retry
(`cli/src/commands/service.ts:71`, `cli/src/commands/service.ts:106`).

## 4. Updating from npm, or from an unreleased commit

The fork publishes `@tickernelz/wardmote*` to npm (section 9), so the
normal update is:

```bash
wardmote update --latest
wardmote update --check
```

`--canary` resolves nothing today, because the release workflow publishes only
`next` and `latest`. A fresh managed install takes the same npm path:

```bash
wardmote install --yes
wardmote install --version 2026.926.1 --yes
wardmote service restart --drain
```

The npm install resolves one exact version with `npm view`, then verifies that
every package in `cli/src/release-packages.ts` (31 packages, kept in step with
`scripts/release-package-manifest.json` by a test) exists at that exact version
before it downloads anything. A partially published release — 2026.926.0 left
`@tickernelz/wardmote-server` in npm's staging queue — is refused with the
missing names rather than installed with mixed versions. It then installs
`@tickernelz/wardmote@<version>` into
`~/.wardmote/cli/installs/npm/<version>` under a private npm user config
that allowlists the `@embedded-postgres/*` install scripts, smoke-tests
`--version` and the payload's PostgreSQL shared-library links, and only then
swaps the payload into place (`cli/src/commands/install.ts`). Measured on this
host, that is ~45 s end to end, against 11 m 38 s for the git path.

Switching an existing instance between a git payload and an npm payload is
non-destructive. An install writes only `~/.wardmote/cli/installs/<source>/<id>`,
the `~/.wardmote/cli/current` symlink, `~/.wardmote/cli/install.json`
and the `~/.local/bin/wardmote` shim. Everything under
`~/.wardmote/instances/<id>` — database, `config.json`, `service.env`,
secrets, logs, storage, backups, workspaces — is untouched, and the two previous
payloads stay available for `wardmote update --rollback`.

To install a ref that is not released yet, reinstall from git:

```bash
wardmote install --ref main --yes
wardmote service restart --drain
```

`--ref` is mandatory for a git install and `--repo` defaults to
`tickernelz/wardmote` (`cli/src/commands/install.ts`). Pass a commit SHA
instead of `main` for a reproducible install; a 7-40 hex ref is treated as
pinned.

The git install downloads `codeload.github.com/<repo>/tar.gz/<sha>`, runs
`pnpm install --frozen-lockfile`, builds, packs every workspace package, installs
the tarballs into a payload directory, smoke-tests `--version`, and only then
swaps the payload into place. A payload for a SHA already built is reused. It
needs pnpm, corepack and the full build toolchain and takes minutes, not seconds.


Roll back to the retained previous payload:

```bash
wardmote update --rollback
```

## 5. Creating a new admin account

`auth bootstrap-ceo` mints a one-time invite URL for the first instance admin
(`cli/src/index.ts:268`, `cli/src/commands/auth-bootstrap-ceo.ts:54`):

```bash
wardmote auth bootstrap-ceo
```

If an admin already exists the command refuses unless you pass `--force`.
Other flags: `--expires-hours <hours>` for the invite window and `--base-url
<url>` when the printed link must use the public hostname rather than the
configured bind address:

```bash
wardmote auth bootstrap-ceo --force --expires-hours 2 \
  --base-url https://paperclip.zhafron.my.id
```

The invite token is stored hashed (`cli/src/commands/auth-bootstrap-ceo.ts:10`);
the plaintext is printed once. The database URL is resolved from
`DATABASE_URL`, then `config.json`; for an embedded instance it defaults to
`postgres://wardmote:wardmote@127.0.0.1:<embeddedPostgresPort>/wardmote`
(`cli/src/commands/auth-bootstrap-ceo.ts:18`).

## 6. Public hostname

`paperclip.zhafron.my.id` is served by the `zhafron-apps` Cloudflare named
tunnel, which maps it to the local instance:

```yaml
  - hostname: paperclip.zhafron.my.id
    service: http://localhost:3100
```

That mapping lives in `~/.cloudflared/zhafron-apps.yml`. It is tunnel
configuration, not Wardmote configuration: changing the instance port means
editing both that ingress entry and `server.port` in `config.json`.

When the instance runs in authenticated/private mode, the public hostname must
also be allowed:

```bash
wardmote allowed-hostname paperclip.zhafron.my.id
```

(`cli/src/index.ts:189`.)

## 7. Database backups

Automatic backups are **on by default**: hourly, written to the instance backup
directory, and only the **2 newest verified backups** are kept
(`database.backup` in `packages/shared/src/config-schema.ts`):

```
enabled: true
intervalMinutes: 60
dir: ~/.wardmote/instances/default/data/backups
maxFiles: 2              # CLI default; the server reads Instance Settings
reservePercent: 5        # free space kept besides the new backup
reserveGb: 10            # reserve = max(reservePercent of the volume, reserveGb)
pinnedMaxAgeDays: 30     # 0 keeps pinned backups until an operator deletes them
retentionDays: 7         # tiered retention only (maxFiles off)
```

The server takes the count from **Instance Settings → General → Backup
retention** (`backupRetention.maxFiles`, default 2, 1–48; "Tiered" restores the
old daily/weekly/monthly tiers). Rotation order is fixed:

1. The dump is written to `<name>.<pid>.partial` and decompressed end to end
   (`verifyGzipBackup`) before it is renamed to `<name>.sql.gz`.
2. Only then are older backups removed. The newest `maxFiles - 1` older backups
   that decompress cleanly are kept; empty, truncated or corrupt files never
   count and are deleted.
3. Before writing, free space on the backup volume must cover the last backup
   × 1.5 plus the reserve. If not, the oldest backups are removed only when the
   newest valid one survives and the new one then fits; otherwise the backup is
   **skipped**, `backup-skipped.json` is written, and the health endpoint and
   the UI banner report `database_backup_skipped_low_disk` until the next
   backup succeeds.

Recovery window with 2 backups is about 1–2 hours: a backup found corrupt later
cannot be recovered from an older one. Raise `maxFiles` when that matters.

A backup that cannot be read (permissions, I/O error) is kept, never counted
toward `maxFiles`, and reported as `database_backup_unreadable` until it is fixed
or removed by hand.

Backup health is surfaced on the health endpoint as `database_backup_missing`,
`database_backup_stale`, `database_backup_skipped_low_disk`, `database_backup_unreadable`,
`database_backup_last_failure`, and `database_backup_check_failed`.

Take a one-off backup:

```bash
wardmote db:backup                     # joins the rotation (keeps 2)
wardmote db:backup --pin               # pinned: <dir>/pinned, outside rotation
wardmote db:backup --max-files 0 --retention-days 30 --json   # tiered
```

Release and rollback dumps must be pinned: `wardmote update` takes its
pre-update backup with `--pin` (skip with `--no-backup`), and release scripts
call `wardmote db:backup --pin`. Pinned backups are never rotated; they are
deleted after `pinnedMaxAgeDays` or by hand.

Backups are `.sql.gz` dumps (`server/src/services/database-backup-health.ts:122`).
They are written inside the instance root, so a backup of the instance root is a
backup of the backups too — copy them off the box if that matters.

### Run-log retention

Run transcripts under `data/run-logs` are trimmed hourly, **on by default**
(`runLogs.retention` in the instance config, `packages/shared/src/config-schema.ts`):

```
enabled: true
dryRun: false
intervalMinutes: 60
minIdleMinutes: 120
keepFullHours: 24
recentTailBytes: 5242880
oldTailBytes: 262144
```

A log of a run that is not queued or running, and was last written more than
`minIdleMinutes` ago, keeps its last `recentTailBytes`; once it is older than
`keepFullHours` it keeps its last `oldTailBytes`. No log file is deleted. The
removed head becomes a hole in the file, so byte offsets, `logBytes`, and every
tail read stay valid; a `<log>.retained.json` sidecar records where the kept
tail starts, and a read from inside the removed part returns one
`[run log retention]` system line followed by the kept tail
(`server/src/services/run-log-retention.ts`, `server/src/services/run-log-store.ts`).

`WARDMOTE_RUN_LOG_RETENTION_DRY_RUN=true` logs what a sweep would trim
(`run log retention dry run`) without touching files;
`WARDMOTE_RUN_LOG_RETENTION_ENABLED=false` turns the sweep off.

### Disk guard

Every 5 minutes the server reads free space (`statfs`) on the backup, run-log,
embedded-Postgres and OMP-session volumes and acts on the fullest one
(`diskGuard` in the instance config, `server/src/services/disk-guard.ts`):

```
enabled: true
intervalMinutes: 5
warnFreePercent: 20      # warning below 20% free or below warnFreeGb
warnFreeGb: 100
actionFreePercent: 10
emergencyFreePercent: 5
ompSessionMaxIdleDays: 7 # 5 at the lowest
```

| Level | Action |
|---|---|
| warning | Health warning `disk_space_low` and UI banner with the numbers; nothing else changes. |
| action | Finished, idle run logs keep 256 KiB (recent) / 64 KiB (old) tails; OMP sessions idle more than 3 days are removed. |
| emergency | Tails shrink to 64 KiB / 16 KiB, finished run logs whose tail is already minimal are deleted oldest first until 10% is free, OMP sessions idle more than 1 day are removed, scheduled backups are skipped, new runs stay queued (`disk_emergency`, like a task drain) and board members get a "disk space is critically low" notification. The server keeps running. |

Logs of queued or running runs are never touched. Issues, comments,
attachments and the database are never deleted. Every cleanup is written to each
company's activity log (`instance.disk_guard.cleanup`, `instance.disk_space.*`)
with free bytes before and after. `WARDMOTE_DISK_GUARD_ENABLED=false` turns it off.

### OMP sessions and blobs

OMP keeps one transcript per task session under `~/.omp/paperclip/sessions`
and images under `~/.omp/agent/blobs`. Hourly, the disk guard deletes session
files (and their sidecar folders) idle longer than `ompSessionMaxIdleDays`,
whatever the issue status, except sessions a queued or running run uses. Once a
day (hourly under pressure) it deletes blobs idle that long that no remaining
transcript references as `blob:sha256:<hash>`. It reads the same transcripts
`omp gc` reads: `*.jsonl`, `*.jsonl.gz` and `*.jsonl.*.bak` under the Wardmote
session root, every per-agent `sessionDir`, `~/.omp/agent/sessions` and
`~/.omp/agent/archive/sessions`, plus the files listed in
`~/.omp/agent/custom-session-files` and `~/.omp/agent/terminal-sessions`. Any
read or decompression error, a per-agent `sessionDir` with a relative path, or
a held `~/.omp/agent/gc.lock` skips blob deletion for that sweep. Only names `omp gc` treats as blobs are deleted.

The sweep runs only on the primary instance: instance id `default` outside a
worktree (`WARDMOTE_IN_WORKTREE`), or any instance that sets
`diskGuard.ompSessionDir` explicitly. `diskGuard.ompSessionSweep` forces it on
or off.

A task whose session file is gone starts a fresh OMP session: the adapter tries
`--resume`, OMP answers `Session "<id>" not found.`, and the run retries once
without it, carrying the issue's continuation summary. A reopened old issue
therefore starts from an empty transcript plus that summary.

## 8. Running the test suite without touching the live instance

The repository's own test helpers can install services, write to
`WARDMOTE_HOME`, and call `systemctl`. **Never run the suite with your normal
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
export WARDMOTE_HOME="$SANDBOX/wardmote"
export XDG_RUNTIME_DIR="$SANDBOX/run"
export DBUS_SESSION_BUS_ADDRESS=
export PATH="$SANDBOX/bin:$PATH"

pnpm test
```

Why each piece is needed:

- `WARDMOTE_HOME` is the single root every instance path derives from
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
systemctl --user is-active wardmote.service
rm -rf "$SANDBOX"
```

For a manual end-to-end instance instead of the unit suite, use the built-in
isolated mode, which never installs a service:

```bash
wardmote test-drive --data-dir /tmp/pcpro-trial --no-browser
```

`--data-dir` isolates state from `~/.wardmote` (`cli/src/index.ts:63`).

## 9. Releasing to npm

One workflow does the whole release: **Release**
(`.github/workflows/release.yml`), one job, no tests — the PR/main CI owns
those. It builds once, packs each package once, publishes the packed tarballs
in dependency order under the `next` dist-tag, waits for npm to expose the
whole set, moves `latest` onto it, then tags the release commit and opens a
GitHub release with notes generated since the previous `v*` tag.

A release is triggered by pushing a `v*` tag. A dispatch stays available for
previews and for resuming a partial publish.

```bash
./scripts/tag-release.sh --dry-run
./scripts/tag-release.sh
```

`scripts/tag-release.sh` resolves the next free version the same way the
workflow does (`./scripts/release.sh --print-version`), refuses a version whose
tag already exists, checks that `ci.yml` is green on `origin/main` HEAD, then
creates the annotated tag on that commit and pushes it.

On a tag push the workflow:

- takes the version from the tag name, which must be `v<YYYY.MDD.P>`;
- runs with `dry_run=false` and `auth=oidc`;
- fails unless the tagged commit is reachable from `origin/main`;
- fails unless `ci.yml` completed successfully for that exact commit. A queued
  or running CI run is polled for about 30 minutes, a completed non-success
  fails immediately, and a commit with no CI run never publishes. `ci.yml` never
  filters its triggers, so every commit gets a run; a documentation-only commit
  runs the full CI like any other and stays releasable once it is green.

The workflow never moves or deletes the tag, and the tag it creates in dispatch
mode is pushed with `GITHUB_TOKEN`, which GitHub does not let re-trigger a
workflow. `concurrency: release` keeps two releases from overlapping.

Preview or resume through a dispatch:

```bash
gh workflow run release.yml --repo tickernelz/wardmote --ref main \
  -f dry_run=true -f auth=oidc -f version=

gh workflow run release.yml --repo tickernelz/wardmote --ref main \
  -f dry_run=false -f auth=oidc -f version=2026.925.3
```

Dispatch inputs:

- `version` — empty resolves the UTC date slot `YYYY.MDD` plus the next patch
  not already published for `@tickernelz/wardmote`, so a same-day rerun
  never collides. Pass an explicit `YYYY.MDD.P` to pin it.
- `dry_run` — `true` previews every step and contacts npm only for read-only
  checks.
- `auth` — `oidc` (the default, and what a tag push uses) authenticates both
  `npm publish` and the `latest` promotion (`npm dist-tag add`) through npm
  trusted publishing. Every package needs one trusted publisher: GitHub
  Actions, `tickernelz/wardmote`, workflow `release.yml`, no environment, with
  `npm publish` and `Allow npm dist-tag` enabled. OIDC dist-tags need npm
  11.21.0+ (or 12.2.0+), so the workflow installs `npm@11.21.2`, and
  `release.sh` refuses to publish over OIDC with an older npm. `token` uses the
  `NPM_TOKEN` repository secret and is only for:
  - a new package, before its trusted publisher can exist (npm needs the
    package page first);
  - finishing a version whose `oidc` run failed at the `latest` promotion,
    for example a package without `Allow npm dist-tag`: rerun that version
    with `auth=token`; published packages are skipped and only the promotion
    runs, with the OIDC identity stripped so npm uses the token;
  - `npm deprecate` and other owner commands, which OIDC does not cover.

The run is idempotent and resumable: a package version already on npm is
skipped, a dist-tag already pointing at the version is left alone, and an
existing tag or GitHub release is not recreated. After a tag push the tag
already exists, so the release step only creates the missing GitHub release.
Rerunning the same version after a partial failure finishes the set.

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
   package (GitHub Actions, `tickernelz/wardmote`, workflow
   `release.yml`, no environment, `npm publish` and `Allow npm dist-tag`).
   That step needs interactive 2FA. npm keeps a new trusted publisher
   `Pending validation` until one OIDC publish runs through it; the package
   page names the deadline, and an unvalidated configuration expires.
4. Afterwards `auth=oidc` covers publishing and the `latest` promotion; keep
   the token for the cases listed under `auth` above.

## 10. Local CLI run concurrency

Local CLI adapters such as `omp_local` are memory-hungry
while they boot: each child loads its extensions, plugins and MCP servers before
it can accept a turn. On 2026-09-25 nine `omp` children started at once, exhausted
WSL memory and stalled the server for 64 seconds. The instance therefore applies
two caps at the queued-run claim point (`server/src/services/heartbeat.ts`,
`startNextQueuedRunForAgent`), and the board shows anything held back as
"Waiting to start".

The limits are set in the board under **Settings → General → Local run limits**
(stored as `general.localRuns` in instance settings, written with
`PATCH /api/instance/settings/general` by an instance admin and logged as
`instance.settings.general_updated`). Each value resolves in this order:

1. the environment variable below, when it is set to a number (operators win;
   the settings page shows that field read-only with the variable name);
2. the value saved in Settings;
3. the built-in default.

`GET /api/instance/settings/local-run-limits` returns the value in force for
each limit, its source (`env`, `setting` or `default`) and the variable that
overrides it. Admission reads the saved settings on every claim decision, so a
change applies to the next queued run without a restart. Lowering a limit never
stops runs that are already running; it only holds new admissions until the
count drops below it.

| Variable | Default | Bounds | Meaning |
| --- | --- | --- | --- |
| `WARDMOTE_MAX_CONCURRENT_LOCAL_RUNS` | 20 | 1–64 | Total local CLI runs this controller may have running at once. Never bypassed. |
| `WARDMOTE_MAX_CONCURRENT_LOCAL_STARTS` | 4 | 1–64 | Local CLI runs allowed to be in their startup phase at once. |
| `WARDMOTE_LOCAL_START_WAIT_BYPASS_SEC` | 120 | 1–3600 | A queued local run that has waited this long starts anyway, ignoring the startup cap but still inside the total cap. The same window bounds the startup phase: a run that has not reported its startup signal within it stops counting as starting, so a hung boot cannot block the gate forever. |
| `WARDMOTE_LOCAL_MEMORY_RESERVE_PERCENT` | 20 | 1–90 | Memory gate, shadow only: no start is delayed. Share of host RAM that must stay available after counting the runs still starting; the verdict is only logged. Also settable under Settings → General. |
| `WARDMOTE_LOCAL_MEMORY_GATE_COOLDOWN_SEC` | 120 | 1–3600 | Memory gate, shadow only. Seconds after a host or service OOM kill during which the logged verdict is "would hold". Also settable under Settings → General. |
| `WARDMOTE_RUN_OOM_SCORE_ADJ` | 500 | -1000–1000 | Linux only. `oom_score_adj` written to every local run child right after spawn, so the kernel OOM killer picks run processes before the server. Lowering below the server's own value needs `CAP_SYS_RESOURCE`; a failed write is logged once and never stops the run. An invalid value falls back to 500. |

A run counts as *starting* from the moment it is claimed until its adapter
declares the child booted. An adapter declares this with the optional
`isStartupComplete(stdoutLine)` hook on its `ServerAdapterModule`; an adapter
that does not implement it is counted as started on its child's first stdout
chunk.

`omp_local` implements it (`packages/adapters/omp-local/src/server/parse.ts`,
`isOmpStartupComplete`) as the first JSON line whose `type` is an agent/turn/
message/tool/result event — `agent_start` in practice. Under the default RPC
transport there is no `{"type":"session"}` header at all (that line is emitted
by print mode only); the startup gate releases on the same event set, so the
observable behaviour is unchanged, but the older "header means alive" reading
no longer applies. Progress notices such as `Still starting after 10s — phase:
loadExtensions` go to **stderr** and never release the gate; on 2026-09-25 a
slow MCP boot printed them at 00:42:04.766 and 00:42:23.716, with `agent_start`
at 00:42:35.617.

**Memory gate (shadow).** Every local run start writes one `info` line, with the
host numbers at the moment of the start decision. No start is delayed in this
mode. Read it from the server journal:

```bash
journalctl --user -u wardmote.service | grep 'local-run-memory-gate shadow'
```

```
local-run-memory-gate shadow run=<id> memAvailableMiB=5120 memTotalMiB=32768 swapFreeMiB=3072 localRuns=7 starting=1 inflightEstimateMiB=614 reservePct=20 reserveMiB=6554 cgroupCurrentMiB=12288 cgroupMaxMiB=na oomKill=0 reason=low_available_memory wouldHold20=yes
```

`wouldHold<N>=yes` means `memAvailable - starting x 614 MiB < N% of memTotal`
(`reason=low_available_memory`), or an OOM kill counter (`/proc/vmstat` plus the
service cgroup `memory.events`) rose within the cooldown
(`reason=oom_kill_cooldown`). `reason=signal_unavailable` means `/proc/meminfo`
could not be read; the gate fails open. To size an enforcement threshold, count
the `wouldHold20=yes` lines against the real delays they would have caused
(`starting` and `localRuns` show the load) and against the OOM kills in
`journalctl -k` over the same window.

Queued local runs are re-evaluated when a local run finishes, when a starting run
reports its startup signal, and on a timer armed for the bypass deadline; the
30-second heartbeat scheduler tick (`HEARTBEAT_SCHEDULER_INTERVAL_MS`) is the
backstop.

## 11. Wardmote MCP tools per adapter

Each adapter arms exactly one Wardmote surface per run and the prompt it sends
describes that surface. `wardmoteAccessMode(config, env)`
(`packages/adapter-utils/src/wardmote-mcp.ts`) returns `mcp` when the
`wardmoteMcp` toggle is on (default) and the run carries both
`WARDMOTE_API_URL` and a run credential, `rest` otherwise.
`wardmoteAgentPromptTemplate(access)` and
`renderWardmoteWakePrompt(..., { wardmoteAccess })` render the heartbeat
contract from that one value, so prompt text cannot drift from what the runtime
actually mounted.

| Adapter | Mounts the Wardmote MCP | How |
| --- | --- | --- |
| `omp_local` | yes | per-run `--extension <tmpdir>` package with one `.mcp.json` |

Adapters that cannot mount, and every run with `wardmoteMcp` off, get
`wardmoteRestGuidance()` instead: `curl` with `$WARDMOTE_API_URL`,
`Authorization: Bearer $WARDMOTE_API_KEY` and
`X-Wardmote-Run-Id: $WARDMOTE_RUN_ID`. No `wardmote*` tool name reaches those
prompts. The `wardmote` skill carries the same fallback under
**No `wardmote*` tools in this runtime**.

### `omp_local` specifics

Every `omp_local` run declares one extra MCP server, `wardmote`, through a
per-run `--extension <tmpdir>` package holding a single `.mcp.json`
(`packages/adapters/omp-local/src/server/wardmote-mcp.ts`). The extension is
appended, so the operator's own `~/.omp/agent/mcp.json` servers keep loading.

By default the entry is `type: http` and points at the server-hosted endpoint
`$WARDMOTE_API_URL/mcp/wardmote?toolsets=core`, with
`Authorization: Bearer ${WARDMOTE_API_KEY}` (an env reference, never a literal)
and `X-Wardmote-Run-Id`. That costs no process and no extra memory per run.
`wardmoteMcpTransport: stdio` is the fallback: it spawns the bundled
`wardmote-mcp-server` with the run's identity in its env. The adapter config
also exposes `wardmoteMcp` (default on) and `wardmoteMcpToolsets`
(default `core`).

MCP is the agents' only path to Wardmote, so the adapter completes an MCP
`initialize` before it spawns OMP: a POST against the endpoint with a 5 s
timeout, or the handshake with the binary under the stdio fallback. Downtime
fails the run with `errorCode: paperclip_mcp_unavailable`, a 401/403 with
`errorCode: paperclip_mcp_credential_rejected`, and the unavailable code is
raised again when OMP itself prints `Warning: MCP server "wardmote" failed to
connect: …` on stderr or as a `notice` frame. The adapter reads whole lines and
matches only a line that starts with that text, so a prompt, tool result or
model message that quotes the warning cannot fail a run. Turning `wardmoteMcp` off logs a warning on the run's stderr: that
agent has no Wardmote tools.

Why the endpoint is the default, measured on 2026-09-25 (WSL, Node 24.18.0,
`core` toolset). The run-time figures come from real sandboxed runs, timed from
the run log's first line to `agent_start`:

| Measurement | Server-hosted endpoint | Bundled stdio server |
| --- | --- | --- |
| run start to `agent_start` | 2123 / 1792 / 1732 ms | 2447 / 2169 ms |
| extra processes per run | 0 | 1 |
| `wardmote-mcp-server` RSS | — | 127.4 / 127.4 / 127.3 MB |

A separate no-MCP baseline, timed from process spawn, was 1842 / 1862 / 2002 ms,
so the endpoint costs roughly nothing at startup while the stdio fallback costs
about half a second and a whole process. That process holds ~127 MB for the life
of the run (61 `core` tools, `tools/list` 35 kB), most of it a floor: a bare
Node 24 process is 43 MB and the MCP SDK with Zod adds about 35 MB before any
Wardmote code, and the same server measured 191–193 MB before its tool
definitions were filtered per toolset. Ten concurrent local runs would hold
about 1.3 GB in stdio servers alone, which is why HTTP is the default.

OMP connects its MCP servers during startup, before `agent_start`, so the tools
are in the tool list for the first model turn; the connect failure warning also
lands before `agent_start`, which is why the adapter can stop the run before a
turn is spent.

## Per-task model and thinking override

A task can run on a different model or thinking level than its assignee's
stored configuration, without editing the agent. The composer's picker next to
the agent selector writes the choice onto the issue; "Agent default" clears it.

Storage reuses the existing per-issue adapter seam,
`issues.assignee_adapter_overrides.adapterConfig`, so there is no new column and
no migration. `buildIssueRunAdapterConfig`
(`server/src/services/issue-run-model-override.ts`) layers that object over the
agent's resolved adapter config when the run's execution config is assembled
(`server/src/services/heartbeat.ts`), which is how `omp_local` ends up passing
`--model` and `--thinking`. The override is also written to the run's context
snapshot as `wardmoteRunModelOverride` so a run log shows which task-level
choice was in force. The agent's own `adapter_config` is never written.

Allowed values come from the adapter, not from a list in the server:
`GET /api/issues/:id/model-override` reads the assignee adapter's published
config schema and returns, per field, its options, the agent default, the
override and the effective value. `PUT /api/issues/:id/model-override` takes
`{ model?, thinking? }`, where `null` clears one field. A `select` field is
validated against the options the adapter publishes; a `text` or `combobox`
field accepts free text and is only checked for being non-empty. For
`omp_local` that means `thinking` is restricted to the adapter's levels
(`auto`, `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) while
`model` accepts any selector, because the adapter publishes it as a combobox so
custom providers keep working. Adapters that publish no config schema, and
tasks with no agent assignee, report `supported: false` and the picker
disappears. Agents cannot set the override; it is a board-side control.

### Inheriting the override to subtasks

The picker carries two switches, persisted next to the override in
`issues.assignee_adapter_overrides.modelOverrideInheritance`:
`inheritToSubtasks` (default `true`) and `subtaskScope`
(`"new"` by default, or `"new_and_existing"`). `PUT /api/issues/:id/model-override`
accepts them alongside `model` and `thinking`. Nothing is stored while both keep
their defaults, so an issue with no inheritance row behaves as "inherit, new
subtasks only".

A child issue picks the override up when it is created — the create route, the
children route and the agent tool path all go through `svc.create`, which calls
`inheritIssueRunModelOverrideForChild`. The copy is marked
`inherited: true` with `sourceIssueId`, which is what distinguishes it from an
override an operator set on that child. A child that sets `model` or `thinking`
itself (including through the create payload's `modelOverride`) keeps its own
value, and a parent never rewrites it afterwards.

`subtaskScope: "new_and_existing"` additionally rewrites the existing subtree at
the moment of the write: `applyIssueRunModelOverrideToSubtree`
(`server/src/services/issue-model-override-inheritance.ts`) walks
`issues.parent_id` breadth-first inside the same company, at most 10 levels deep
and at most 500 issues, with a visited set so a parent cycle terminates instead
of looping. An issue that owns an explicit override is skipped together with its
subtree, because that subtree follows the child, not the root. The response
reports `propagation: { applied, skipped, visited, limitReached }`; `limitReached`
means the walk stopped at a limit and deeper issues were left alone. Clearing the
override ("Agent default") propagates the same way and under the same switches.

A create request may carry the override in one round trip:
`POST /api/companies/:id/issues` and `POST /api/issues/:id/children` accept
`modelOverride: { model?, thinking?, inheritToSubtasks?, subtaskScope? }`,
validated against the assignee's adapter schema exactly like the PUT and
rejected with 422 when it does not fit.

### Where the picker appears

Three surfaces share one control
(`ui/src/components/task-chat/TaskModelOverrideControl.tsx`):

- The task chat composer of an existing task. It reads and writes the issue.
- The New Task modal, next to the Auto mode chip. The task does not exist yet,
  so the option lists come from
  `POST /api/agents/batch/adapter-config/preview` for the chosen assignee,
  filtered to `model` and `thinking`, and the choice travels in the create
  request as `modelOverride`. Without an assignee the control is disabled. The
  two inheritance switches sit in the picker's footer here, because a new task
  is the only place where they apply before a run exists.
- The agent chat composer. It is scoped to the conversation issue
  (`issues.conversation_agent_id`), so the choice survives for that chat. A
  chat whose issue does not exist yet resolves it when the picker opens, which
  is the same write the first message performs. Chat-created tasks have no
  parent, so the subtask switches stay hidden there.

## Changing model or thinking for many agents at once

The Agents list has a checkbox per row plus a select-all for the current filter
tab; with a selection, "Change model / thinking" opens a batch dialog that shows
how many agents are affected, asks for a confirmation and then reports a
per-agent result.

Two endpoints back it:

- `POST /api/agents/batch/adapter-config/preview` with `{ agentIds }` returns the
  fields the selection shares — the intersection of the batch-editable fields of
  each agent's adapter schema, with the option lists intersected too — plus each
  agent's eligibility, reason and current values.
- `POST /api/agents/batch/adapter-config` with `{ agentIds, values }` applies
  them. Up to 100 agents per call.

Batch-editable keys are the model-selection keys an adapter publishes: `model`,
`thinking`, `provider`, `smolModel`, `slowModel`, `planModel`, `modelCycle`, and
only when the adapter publishes them as `select`, `text` or `combobox`. Anything
else — credentials, paths, instructions bundles, and `provider` on a
`wardmote_runner` agent, whose transition checks only the single-agent route
runs — stays out and must go through `PATCH /api/agents/:id`.

Validation is per agent against that agent's own adapter schema, with the same
rules as the per-task override. **The batch is atomic:** one invalid value
rejects the whole call with 422 and a `failures[]` array naming the agent, the
key and the reason, and nothing is written. On success each changed agent gets
one `agent.updated` activity row attributed with `getActorInfo`, carrying
`changedAdapterConfigKeys` and `batch: true`; an agent whose values already match
is reported as `unchanged` and is not audited. Authorization is the same as
editing one agent: a board caller with company access and the `agents:create`
decision, or an agent actor holding `company:agents` (a `ceo`); every agent id is
resolved through the company guard first, so a cross-company id is a 404 and a
batch may never span companies.

`fallbackModels` is the one list field. The preview lists it when any selected
agent's adapter publishes it (today only `omp_local`), and each agent carries its
`currentLists` and `unsupportedKeys`. In the dialog it is either replaced with an
ordered list of up to 5 models or cleared. Per agent, a model equal to that
agent's primary (its new `model` when the batch also sets one) is dropped and
reported in `droppedValues`; agents whose adapter lacks the field are skipped and
reported in `skippedKeys` instead of failing the batch. A batch that changes
`model` also drops the new primary from an agent's existing fallback list.

## Fallback models (`omp_local`)

`adapterConfig.fallbackModels` holds up to 5 OMP selectors tried in order when the
main model hits a rate limit or quota, an upstream failure (overload, 5xx, timeout,
dropped connection) or a refusal. Auth and context-length errors never fall back,
and the small, slow and planning models have no fallback. An empty list keeps the
old behaviour. The list must not repeat a model or contain the primary; the
single-agent and batch writes both validate it. Design notes:
`doc/plans/2026-10-11-agent-fallback-models.md`.

- Inside a run OMP does the switching. Each run's `--config` overlay adds
  `retry.fallbackChains` keyed by the model the run starts on; OMP deep-merges
  overlays, so the owner's own chains in `~/.omp/agent/config.yml` keep working.
  OMP returns to the primary when its suppression expires.
- Provider limits are shared, so cooldowns live in `model_cooldowns` per company and
  selector. One is written when OMP reports a switch (its retry-after, else 5 min)
  and when a run fails with quota or upstream errors. A new run starts on the
  first model that is not cooling down; a task model override counts as the
  primary and the agent list follows it.
- A refusal is retried by Wardmote on the next model, without a cooldown. A quota
  or upstream failure is retried on the next free model at the normal backoff; if
  every model is cooling down the existing retry timing applies.
- Each switch writes a `model.fallback` run event and an `issue.run_model_fallback`
  activity row; Live now shows `Fallback: <model> · <provider> (primary: <reason>)`.
  When every model has failed and the run gives up, a `model.fallback_exhausted`
  event raises a Decisions item that clears once the agent has a successful run.

## Security: emptying allowedHostnames does not lock out the public host

`auth.publicBaseUrl` is always folded into the hostname allow-list (`server/src/config.ts`), so `https://paperclip.zhafron.my.id` stays reachable even when `server.allowedHostnames` is empty. On 2026-09-24 a sign-up POST through the tunnel succeeded with `auth.disableSignUp=false` and `allowedHostnames=[]` for exactly this reason. Separately, the guard used to trust a client-supplied `X-Forwarded-Host`; that is fixed, and the header is now honoured only when `TRUST_PROXY` declares the peer trusted.

Keep `auth.disableSignUp=true` whenever the tunnel is up. To add a person:

1. Use the invite flow: `wardmote auth bootstrap-ceo --force --base-url https://paperclip.zhafron.my.id` for a new instance admin, or a company invite from the board.
2. If sign-up must be opened briefly, first remove the `paperclip.zhafron.my.id` ingress from `~/.cloudflared/zhafron-apps.yml` and restart `zhafron-apps-tunnel.service`, then restore it after `disableSignUp` is back to `true`.

Verify the seal after any auth change:

```bash
curl -s -X POST https://paperclip.zhafron.my.id/api/auth/sign-up/email \
  -H 'Content-Type: application/json' -H 'Origin: https://paperclip.zhafron.my.id' \
  -d '{"name":"probe","email":"probe@example.invalid","password":"x-probe-x-probe"}'
```

Expected: `400 EMAIL_PASSWORD_SIGN_UP_DISABLED`.

## CLI login for board operations

`wardmote service restart --drain` and other board calls need a board credential. Run `wardmote auth login --instance-admin` and approve the printed URL while signed in to the board. Approval is rejected unless the request carries a trusted browser origin, so approve it from the board in a browser, not with a bare API call.
