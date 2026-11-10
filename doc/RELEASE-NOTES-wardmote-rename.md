# Release notes: Paperclip Pro becomes Wardmote

This release uses only the Wardmote names. Nothing reads the old names any more; an existing install is moved over once, by `wardmote migrate-home`, and the server rewrites the old names in stored agent text on start.

## What changes

- **Command, shim and service.** The CLI command is `wardmote` and a managed install writes only `~/.local/bin/wardmote`. The systemd user unit is `wardmote.service` (`wardmote-<instance>.service` for other instances) and the launchd label is `com.tickernelz.wardmote`. The `paperclip-pro` command, shim, root script and unit name are gone.
- **Home folder.** State lives in `~/.wardmote`. A command that finds an unmigrated `~/.paperclip-pro` stops and asks for `wardmote migrate-home` instead of starting an empty home.
- **Environment.** Only `WARDMOTE_*` names are read. On start the instance `.env` file has its `PAPERCLIP_*` keys renamed in place, with a `0600` backup. Env keys an operator set on an agent keep their names.
- **MCP, headers and skills.** MCP tools are `wardmote*` on the `wardmote` server at `/mcp/wardmote`; old tool names are refused. Headers are `X-Wardmote-*`; `X-Paperclip-*` is refused and redacted in logs. The built-in skills are `wardmote`, `wardmote-board`, `wardmote-converting-plans-to-tasks` and `wardmote-create-agent` under the `tickernelz/wardmote/` key prefix (database migrations 0358 and 0359).
- **Stored agent text.** On every start the server rewrites the retired env, tool, header, route and skill names in agent instruction files, agent settings and their history, routines and chat endpoints. It backs up each changed file and row under `backups/wardmote-rename-<time>/`; a second start changes nothing. `wardmote migrate-names --dry-run` lists the changes without writing.
- **Paperclip Cloud, Labs and EE** are removed: managed-cloud mode, Cloud sign-in, the Cloud connector broker, onboarding seeds and the related routes and UI.
- **Stored channel values.** Approvals, grants, autonomy windows and owner relays decided in the board record `wardmote` as their channel, and the local board user's address is `local@wardmote.local`; database migration 0360 rewrites existing rows. API responses carry `wardmote` where they carried the old value.

## Upgrading an existing install

An install on 2026.1109.x or older still runs the old `update` code, which cannot switch the service over, so the switch takes one extra command:

1. Take a backup while the service runs: `paperclip-pro db:backup`.
2. Stop the service once no agent run is live: `paperclip-pro service stop`.
3. Install the new release without restarting: `paperclip-pro update --version <new> --no-backup`. The service is stopped, so the old code installs the payload and does not restart it.
4. Move everything to the new names: `~/.paperclip-pro/cli/current/node_modules/.bin/wardmote migrate-home` (`--dry-run` prints the plan first). It refuses while a service or embedded database is running. It renames `~/.paperclip-pro` to `~/.wardmote` and leaves `~/.paperclip-pro` as a link so absolute paths stored in the database keep working. It replaces `paperclip-pro.service` with `wardmote.service`, keeping whether it was enabled. It replaces the `paperclip-pro` shim with the `wardmote` shim, and renames the install-store and shell PATH markers.
5. Start it: `wardmote service start`. The server applies the database migrations and rewrites stored agent text.

`npx @tickernelz/wardmote install` and `wardmote update` run step 4 on their own when they find the old layout and the service is stopped.

## Rolling back

`wardmote update --rollback` flips back to the previous payload when it contains the `wardmote` command (2026.1108.0 or newer) and refuses otherwise. An older release does not know the `wardmote.service` name, so restart the service yourself afterwards: `systemctl --user restart wardmote.service`. Database migrations are not reversed; restore the backup from step 1 if needed. Stored agent text can be restored from `backups/wardmote-rename-<time>/`.

## Kept on purpose

- The MIT copyright notice of the upstream project in `LICENSE`.
- Upstream-sync references to `github.com/paperclipai` until upstream sync is decided.
- Applied database migrations, archived plans and earlier release notes, which describe the past.
- The migration code itself, which has to recognise the old names to move them.
