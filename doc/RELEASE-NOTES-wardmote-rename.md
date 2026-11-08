# Release notes: Paperclip Pro becomes Wardmote

## What changes

- **Name.** The CLI, the web UI, the README and the docs say Wardmote. The CLI command is `wardmote`; `paperclip-pro` runs the same program for one more release. A managed install writes both `~/.local/bin/wardmote` and `~/.local/bin/paperclip-pro`.
- **Home folder.** A new install keeps its state in `~/.wardmote`. An existing `~/.paperclip-pro` is used as before, with no action: the service unit, `db:backup`, `install`, `update` and the dev scripts all still find it. `wardmote migrate-home` moves it to `~/.wardmote` when the owner decides to (see below).
- **Environment.** Every `PAPERCLIP_*` variable has a `WARDMOTE_*` name. Both are read; when both are set, `WARDMOTE_*` wins. A process that still reads an old name prints one deprecation warning listing the names to rename.
- **Agent runs** receive both names for every small value (up to 4096 bytes, never a `*_JSON` value). Larger values keep only the `PAPERCLIP_*` name, so a run's environment cannot double a large string and hit the 131072-byte per-string spawn limit (`E2BIG`). A stale `WARDMOTE_*` copy never shadows the value the run was given, and `WARDMOTE_API_KEY` is refused from agent config exactly like `PAPERCLIP_API_KEY`.
- **MCP tools.** A call to `wardmoteListIssues` (any `wardmote*` spelling) runs `paperclipListIssues`. `paperclipGetInstanceSettingFeatures` and `paperclipUpdateInstanceFeatures` (and their `wardmote*` spellings) run `paperclipGetInstanceSettingExperimental` and `paperclipUpdateInstanceExperimental`. `tools/list` still advertises only the `paperclip*` names, and the MCP server is still named `paperclip`, so agents keep seeing `mcp__paperclip_*`.

## Unchanged on purpose

- **npm package names.** All 31 packages keep the `@tickernelz/paperclip-pro*` names in this release. `paperclip-pro install --version <new>` on an existing machine therefore installs this release with the code it already has, the publish count stays 31, and no new npm package has to be claimed or bootstrapped. The `@wardmote` scope is neither checked nor owned. Renaming the meta package needs a thin `@tickernelz/paperclip-pro` wrapper for one release; that is left for a release that also renames the internal packages.
- **Service names.** The systemd unit stays `paperclip-pro.service` and the launchd label `ing.paperclip.paperclip-pro`, and the unit still runs the `paperclip-pro` shim, which exists on every install. The unit now sets both `WARDMOTE_*` and `PAPERCLIP_*` for its home, instance and service flag, so a rollback to an older release reads the same home.
- **Install markers.** The managed shim, install-store and shell PATH markers keep their text so an upgrade recognises what an older release wrote.
- **Agent-facing contracts.** `PAPERCLIP_*` variables in agent runs, the shipped skills, agent `AGENTS.md` bundles, HTTP headers such as `X-Paperclip-Run-Id`, and server prompts keep their names. So do MCP tool descriptions, the shared tool descriptions agents read (Browser Use, Local Browser, Slack, OpenWA), voice notifications, the fast-response receipt, and the external-agent tool guidance, which stays word-for-word aligned with the Runner's copy.
- **Third-party names.** Paperclip Cloud, Paperclip Labs, Paperclip EE, the Paperclip Cloud GitHub app and the Paperclip robot account belong to Paperclip Labs and keep their names. Sign-in methods brokered by Paperclip Cloud now say so ("Connect with Paperclip Cloud", "Paperclip Cloud OAuth").
- **Local Browser extension.** The extension is still published as "Paperclip Local Browser Bridge", so the update hint names it that way.

## Moving the home folder

Stop the service first, then run `wardmote migrate-home` (`--dry-run` prints the plan). It refuses while the service or an embedded database is running, when `~/.wardmote` already exists, or when `WARDMOTE_HOME`/`PAPERCLIP_HOME` is set. It renames `~/.paperclip-pro` to `~/.wardmote` on the same filesystem, leaves `~/.paperclip-pro` as a link to it so absolute paths stored in the database and scripts keep working, and rewrites the old path in installed service definitions. Config paths that still name `~/.paperclip-pro` resolve under `~/.wardmote` once the old folder is gone.

## Removed in the next release

- `tools/list` advertises `wardmote*` names and the `paperclip*` tool names are no longer accepted.
- `PAPERCLIP_*` environment names are no longer read, agent runs receive only `WARDMOTE_*`, and the internal code switches to the new names.
- The `paperclip-pro` command, the `paperclip-pro` root script and the `paperclip-pro` shim are removed; the service unit runs `wardmote`.
