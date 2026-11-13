# Installing Wardmote

> **Fork notice.** This repository is [`tickernelz/wardmote`](https://github.com/tickernelz/wardmote), a hard fork of `paperclipai/paperclip` at `7b7c4d417`. It publishes its own packages under the `@tickernelz` npm scope. `https://paperclip.ing/install.sh` installs **upstream Wardmote**, not this fork; ignore any vanity-installer instruction that survives from upstream.

Wardmote supports a managed installation from the published npm packages
and a development installation from a git ref. The npm installation is the
default and the supported path: it provides atomic updates, rollback, and a
stable entrypoint for the background service without a local toolchain.

## Recommended Install

On macOS, Linux, or WSL2, with Node.js 24.11+ and `npm`:

```sh
npx @tickernelz/wardmote@latest install --yes
```

`install` resolves the `latest` dist-tag of `@tickernelz/wardmote` from
`https://registry.npmjs.org`, installs that version and its package set into a
payload under `~/.wardmote/cli/installs/npm/<version>`, smoke-tests
`--version` and the payload's embedded-PostgreSQL native assets, and only then
flips the `current` pointer and writes the `~/.local/bin/wardmote` shim
(`cli/src/commands/install.ts`).

Pin an exact published version with `--version`:

```sh
wardmote install --version 2026.926.1 --yes
```

The install writes its own npm user config, so the payload never inherits the
operator's registry or script settings. It allowlists the install scripts of the
`@embedded-postgres/*` platform packages, which is what creates the shared-library
symlinks the bundled PostgreSQL binaries link against; npm 12 blocks those scripts
by default and a payload without them cannot start its database.

## Development install from a git ref

A git install builds the workspace from a GitHub commit instead of downloading
published packages. It takes minutes instead of seconds and needs pnpm 9.15.4,
`git`, `curl`, `tar`, and `corepack`:

```sh
wardmote install --ref main --yes
wardmote install --repo tickernelz/wardmote --ref <commit-sha> --yes
```

`--ref` selects the commit and `--repo` defaults to `tickernelz/wardmote`
(`cli/src/commands/install.ts`). `--ref` cannot be combined with `--canary` or
`--version`, which resolve against npm. Pass a commit SHA instead of `main` for
a reproducible, pinned install.

Then onboard:

```sh
wardmote onboard --yes
```

Day-two operation — state layout, `service.env`, safe restarts, updates,
backups, admin bootstrap, sandboxed test runs — is in
[`../docs/fork/OPERATIONS.md`](../docs/fork/OPERATIONS.md).

Codex ACP workspace sessions enable networking so agents can report task outcomes.
To disable it explicitly, set `extraArgs` to
`["-c", "sandbox_workspace_write.network_access=false"]`, or set
`env.WARDMOTE_CODEX_ACP_NETWORK_ACCESS="false"`. Execution-target network denial
also remains enforced. Read-only ACP mode remains read-only.

## Node runtime used by background services

Check the Node executable used by the running service, not only `node --version`
in an interactive shell. Systemd and launchd do not load shell version-manager
configuration. A newer Node installed elsewhere does not upgrade a running
service or change a custom startup script's `PATH`.

Managed installs pin the validated Node executable in the `wardmote` shim
and prepend its directory to `PATH` for child tools, including ACP servers with
an `/usr/bin/env node` shebang. Re-run the installer using the supported
Node runtime after changing runtime installations, then restart the service.
For example, put the supported Node's bin directory first on `PATH` and run
`wardmote install --yes` again. Do not use the old managed shim to
re-pin Node: it intentionally continues launching its previously pinned runtime.
Installs and updates refresh existing managed shims in place. Updates reject an
unsupported running Node before installing or activating a payload; read-only
update checks and rollback remain available for recovery. Global npm installs and
source checkout services must configure their own executable and child-process `PATH`.

For custom service wrappers, use an absolute, supported Node executable and put
that executable's directory first on `PATH`. Keep required existing PATH entries.
On Linux, verify the running executable with `/proc/<server-pid>/exe`; an
interactive shell version check alone is insufficient. Use the guarded restart
procedure in [DEVELOPING.md](DEVELOPING.md#hot-restart-deploys) when jobs are active.

Legacy local adapters default to ACP, including configurations with no `engine`
field or the old `auto` value. An unavailable ACP runtime fails the run and the
agent environment test with a setup error; it never silently changes engines.
Repair the reported prerequisite or explicitly select `engine: cli`. Local
filesystem/network confinement and in-place Codex workspaces require explicit
CLI selection. CLI sandbox defaults and explicit restrictions are described in
the adapter configuration documentation.

## Managed Install Layout

Managed code is separate from instance data:

```text
~/.wardmote/cli/
├── install.json
├── current -> installs/npm/2026.720.0
└── installs/
    ├── npm/<version>/
    └── git/<sha12>/

~/.local/bin/wardmote
```

The `wardmote` shim remains stable while `current` switches atomically
between complete payloads. Wardmote keeps the two previous managed payloads
for rollback. Configuration, databases, uploads, logs, secrets, and workspaces
remain under `~/.wardmote/instances/` and are not stored inside CLI payloads.

If `~/.local/bin` is not on `PATH`, the installer offers to update the relevant
shell startup file when running interactively. Non-interactive installs print
the exact `export PATH` command instead of editing shell files silently.

## Install Sources

`wardmote install` with no source flag follows the `latest` dist-tag of
`@tickernelz/wardmote`, and `--version <YYYY.MDD.P>` pins one published
version; both resolve against `https://registry.npmjs.org`. `--canary` follows
the `canary` dist-tag, which the release workflow does not publish today.

```sh
wardmote install --yes
wardmote install --version 2026.926.1 --yes
```

Install a git ref instead when you need an unreleased commit:

```sh
wardmote install --ref main --yes
wardmote install --repo tickernelz/wardmote --ref <commit-sha> --yes
```

`--repo` defaults to `tickernelz/wardmote`; point it at another GitHub
repository to install a different fork.

Before the shim exists, run the npm install through `npx`
(`npx @tickernelz/wardmote@latest install --yes`), or run a git install
from a source checkout with
`node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts install ...`.

Git-ref installs resolve the requested ref to an exact commit before building.
Review and trust the repository and ref: installing a git ref executes that
revision's package installation and release build scripts on your machine.


## Onboarding And The Service

Run onboarding after a non-interactive installation:

```sh
wardmote onboard
```

Interactive onboarding asks whether Wardmote should run as a background
service when the platform supports one. Automated onboarding deliberately does
not install a service unless explicitly requested:

```sh
wardmote onboard --yes                    # configure only; no service install
wardmote onboard --yes --install-service  # explicit automation opt-in
wardmote onboard --yes --no-install-service
```

After onboarding installs and starts the service, it waits for the service to
report its selected runtime port and then prints the dashboard URL. Interactive
terminals open that URL in the default browser; headless and non-interactive
runs print the URL without trying to launch a browser.

Service commands are namespaced:

```sh
wardmote service install
wardmote service status
wardmote service start
wardmote service stop
wardmote service restart
wardmote service logs -f
wardmote service uninstall
```

Wardmote uses a systemd user service on Linux and WSL2 systems with user
systemd, and a LaunchAgent on macOS. Containers, WSL1, and systems without a
supported user service manager receive foreground `wardmote run` guidance
instead of a hard failure.

The service uses the stable managed-install shim, restarts after crashes, and
can start on login. On Linux, service installation may offer to enable user
lingering so it can continue without an active login session. The command
explains and confirms that system-level action before running it.

Use one server process per instance. `wardmote run` refuses to start when
the same instance is already supervised; stop the service first or use
`--force` only when you intentionally accept the single-writer risk.

## Update And Rollback

Update according to the source and channel recorded in the install manifest:

```sh
wardmote update
```

Select a different release source explicitly:

```sh
wardmote update --latest
wardmote update --canary
wardmote update --version 2026.720.0
```

Managed updates create a database backup before switching payloads, verify the
new CLI, atomically flip `current`, and restart an installed service. A failed
install or verification leaves the previous payload active.

If the service is stopped, start it with `wardmote service start` before
updating so Wardmote can take the safety backup. Use
`wardmote update --no-backup` only when you intentionally accept updating
without that rollback safeguard. A never-onboarded instance with no config or
instance data skips the backup automatically because there is nothing to save.

Roll back to the previous retained payload:

```sh
wardmote update --rollback
```

The `upgrade` command is an alias for `update`. Exact versions and commit SHAs
are pinned; provide a new target when you want them to move.

## Moving From `@tickernelz/wardmote`

Releases up to 2026.1108.0 were published as `@tickernelz/wardmote`. That
CLI only resolves its own package name, so `wardmote update` stays on the
last release published under it. Move an existing managed install once with
the new package; it keeps the same home, database, shims, and service:

```sh
npx @tickernelz/wardmote@latest install --yes
wardmote service restart --drain
```

`wardmote update --rollback` returns to the payload you moved from. To
install another release published under the old name, run that release's own
CLI: `npx @tickernelz/wardmote@<version> install --version <version> --yes`.

## Other Installation Methods

A global npm install (`npm install -g @tickernelz/wardmote`) works and is
updated by `wardmote update`, but it has no payload store, so it offers no
atomic activation and no rollback. Prefer the managed install above.

Source checkout for development:

```sh
git clone https://github.com/tickernelz/wardmote.git
cd wardmote
pnpm install --frozen-lockfile
pnpm dev
```

Isolated manual trial that never installs a service:

```sh
node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts test-drive --data-dir /tmp/pcpro-trial --no-browser
```

The managed `wardmote update` command updates managed installs. For source
checkouts it reports the appropriate git workflow instead of modifying the
checkout automatically.


## Diagnose An Installation

Run:

```sh
wardmote doctor
wardmote service status
```

`doctor` checks the managed install store, manifest, `current` link, shim,
`PATH`, Node.js version, and service state. Service diagnostics cover unit-file
presence and drift, running state, configured port ownership, and the running
server version.

The CLI and server also print a non-blocking startup warning when Node.js is
below the supported minimum. Upgrade Node.js with a version manager or follow
the downloaded `install.sh` workflow under **Recommended Install**. Do not use
the piped form for this repair because it requires a supported Node.js runtime
before it starts.

## Uninstall

Remove the background service and managed CLI payloads:

```sh
wardmote service uninstall
wardmote uninstall
```

`wardmote uninstall` removes the managed shim, manifest, and CLI payloads.
It deliberately preserves `~/.wardmote/instances/`, including configuration,
databases, uploads, logs, secrets, backups, and workspaces. Back up and remove
that data separately only when you intend to delete the Wardmote instance.
