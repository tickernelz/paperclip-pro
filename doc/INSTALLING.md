# Installing Paperclip Pro

> **Fork notice.** This repository is [`tickernelz/paperclip-pro`](https://github.com/tickernelz/paperclip-pro), a hard fork of `paperclipai/paperclip` at `7b7c4d417`. It publishes nothing to npm, and `https://paperclip.ing/install.sh` installs **upstream Paperclip**, not this fork. Ignore any npm or vanity-installer instruction below that survives from upstream: the supported install path for this product is the git install in the next section.

Paperclip Pro supports a managed installation from a git ref and development
from a source checkout. The managed installation is recommended because it
provides atomic updates, rollback, and a stable entrypoint for the background
service.

## Recommended Install

On macOS, Linux, or WSL2, with Node.js 24.11+, pnpm 9.15.4, `git`, `curl`,
`tar`, and `corepack` available:

```sh
git clone https://github.com/tickernelz/paperclip-pro.git
cd paperclip-pro
pnpm install --frozen-lockfile
node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts install --repo tickernelz/paperclip-pro --ref main --yes
```

`install` resolves the ref through the GitHub API, downloads that exact commit
as a tarball, builds the workspace, packs every workspace package, installs the
tarballs into a payload under `~/.paperclip-pro/cli/installs`, smoke-tests
`--version`, and only then flips the `current` pointer and writes the
`~/.local/bin/paperclip-pro` shim.

`--repo` is required: it defaults to the upstream repository
(`cli/src/commands/install.ts:27`). `--ref` is mandatory for a git install and
cannot be combined with `--canary` or `--version`, which resolve against npm
(`cli/src/commands/install.ts:139`-`cli/src/commands/install.ts:147`). Pass a
commit SHA instead of `main` for a reproducible, pinned install.

Then onboard:

```sh
paperclip-pro onboard --yes
```

Day-two operation — state layout, `service.env`, safe restarts, updates,
backups, admin bootstrap, sandboxed test runs — is in
[`../docs/fork/OPERATIONS.md`](../docs/fork/OPERATIONS.md).

Codex ACP workspace sessions enable networking so agents can report task outcomes.
To disable it explicitly, set `extraArgs` to
`["-c", "sandbox_workspace_write.network_access=false"]`, or set
`env.PAPERCLIP_CODEX_ACP_NETWORK_ACCESS="false"`. Execution-target network denial
also remains enforced. Read-only ACP mode remains read-only.

## Node runtime used by background services

Check the Node executable used by the running service, not only `node --version`
in an interactive shell. Systemd and launchd do not load shell version-manager
configuration. A newer Node installed elsewhere does not upgrade a running
service or change a custom startup script's `PATH`.

Managed installs pin the validated Node executable in the `paperclip-pro` shim
and prepend its directory to `PATH` for child tools, including ACP servers with
an `/usr/bin/env node` shebang. Re-run the installer using the supported
Node runtime after changing runtime installations, then restart the service.
For example, put the supported Node's bin directory first on `PATH` and run
`paperclip-pro install --repo tickernelz/paperclip-pro --ref main --yes` from a
source checkout via `pnpm paperclip-pro`. Do not use the old managed shim to
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
~/.paperclip-pro/cli/
├── install.json
├── current -> installs/npm/2026.720.0
└── installs/
    ├── npm/<version>/
    └── git/<sha12>/

~/.local/bin/paperclip-pro
```

The `paperclip-pro` shim remains stable while `current` switches atomically
between complete payloads. Paperclip keeps the two previous managed payloads
for rollback. Configuration, databases, uploads, logs, secrets, and workspaces
remain under `~/.paperclip-pro/instances/` and are not stored inside CLI payloads.

If `~/.local/bin` is not on `PATH`, the installer offers to update the relevant
shell startup file when running interactively. Non-interactive installs print
the exact `export PATH` command instead of editing shell files silently.

## Install Sources

The npm channels below exist in the CLI but resolve against the public npm
registry, which carries no `@tickernelz/paperclip-pro` package. For this fork,
`--canary` and `--version` are unusable; install a git ref.

Install this fork's `main`:

```sh
paperclip-pro install --repo tickernelz/paperclip-pro --ref main --yes
```

Pin a tag or an exact commit:

```sh
paperclip-pro install --repo tickernelz/paperclip-pro --ref v0.3.1 --yes
paperclip-pro install --repo tickernelz/paperclip-pro --ref <commit-sha> --yes
```

Without `--repo`, `--ref` installs from upstream `paperclipai/paperclip`
(`cli/src/commands/install.ts:27`), which is a different product.

Before the shim exists, run the same command from a source checkout with
`node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts install ...`.

Git-ref installs resolve the requested ref to an exact commit before building.
Review and trust the repository and ref: installing a git ref executes that
revision's package installation and release build scripts on your machine.


## Onboarding And The Service

Run onboarding after a non-interactive installation:

```sh
paperclip-pro onboard
```

Interactive onboarding asks whether Paperclip should run as a background
service when the platform supports one. Automated onboarding deliberately does
not install a service unless explicitly requested:

```sh
paperclip-pro onboard --yes                    # configure only; no service install
paperclip-pro onboard --yes --install-service  # explicit automation opt-in
paperclip-pro onboard --yes --no-install-service
```

After onboarding installs and starts the service, it waits for the service to
report its selected runtime port and then prints the dashboard URL. Interactive
terminals open that URL in the default browser; headless and non-interactive
runs print the URL without trying to launch a browser.

Service commands are namespaced:

```sh
paperclip-pro service install
paperclip-pro service status
paperclip-pro service start
paperclip-pro service stop
paperclip-pro service restart
paperclip-pro service logs -f
paperclip-pro service uninstall
```

Paperclip uses a systemd user service on Linux and WSL2 systems with user
systemd, and a LaunchAgent on macOS. Containers, WSL1, and systems without a
supported user service manager receive foreground `paperclip-pro run` guidance
instead of a hard failure.

The service uses the stable managed-install shim, restarts after crashes, and
can start on login. On Linux, service installation may offer to enable user
lingering so it can continue without an active login session. The command
explains and confirms that system-level action before running it.

Use one server process per instance. `paperclip-pro run` refuses to start when
the same instance is already supervised; stop the service first or use
`--force` only when you intentionally accept the single-writer risk.

## Update And Rollback

Update according to the source and channel recorded in the install manifest:

```sh
paperclip-pro update
```

Select a different release source explicitly:

```sh
paperclip-pro update --latest
paperclip-pro update --canary
paperclip-pro update --version 2026.720.0
```

Managed updates create a database backup before switching payloads, verify the
new CLI, atomically flip `current`, and restart an installed service. A failed
install or verification leaves the previous payload active.

If the service is stopped, start it with `paperclip-pro service start` before
updating so Paperclip can take the safety backup. Use
`paperclip-pro update --no-backup` only when you intentionally accept updating
without that rollback safeguard. A never-onboarded instance with no config or
instance data skips the backup automatically because there is nothing to save.

Roll back to the previous retained payload:

```sh
paperclip-pro update --rollback
```

The `upgrade` command is an alias for `update`. Exact versions and commit SHAs
are pinned; provide a new target when you want them to move.

## Other Installation Methods

The npm-registry routes below cannot serve this fork: neither `paperclip-pro`
nor `@tickernelz/paperclip-pro` is published (`npm view` returns 404). The only
alternative to a managed git install is a source checkout.

Source checkout for development:

```sh
git clone https://github.com/tickernelz/paperclip-pro.git
cd paperclip-pro
pnpm install --frozen-lockfile
pnpm dev
```

Isolated manual trial that never installs a service:

```sh
node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts test-drive --data-dir /tmp/pcpro-trial --no-browser
```

The managed `paperclip-pro update` command updates managed installs. For source
checkouts it reports the appropriate git workflow instead of modifying the
checkout automatically; for this fork, re-run
`paperclip-pro install --repo tickernelz/paperclip-pro --ref <ref> --yes`.


## Diagnose An Installation

Run:

```sh
paperclip-pro doctor
paperclip-pro service status
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
paperclip-pro service uninstall
paperclip-pro uninstall
```

`paperclip-pro uninstall` removes the managed shim, manifest, and CLI payloads.
It deliberately preserves `~/.paperclip-pro/instances/`, including configuration,
databases, uploads, logs, secrets, backups, and workspaces. Back up and remove
that data separately only when you intend to delete the Paperclip instance.
