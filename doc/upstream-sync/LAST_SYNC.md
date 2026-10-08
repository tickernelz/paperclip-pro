# Last upstream sync

| Field | Value |
| --- | --- |
| Upstream repository | https://github.com/paperclipai/paperclip |
| Upstream branch | `master` |
| Upstream commit merged | `81cd03b3b542ea4af291ef56d5084fbf6410eb9c` |
| Previous merge base | `7b7c4d4172d6aac14919e2682b702ae87bc17653` |
| Date | 2026-10-06 |
| Fork branch | `sync/upstream-20261006` (from `origin/main` `93e85185c`) |
| Fork merge commit | `dde142577813f8a0207e1fe02c8a9a760301cfcf` (parents: fork `c74245d68`, upstream-renamed `5c49b4529` whose parent is upstream `81cd03b3b`) |
| Conflict decisions | [2026-10-06-conflicts.md](2026-10-06-conflicts.md) |

The next sync starts from `81cd03b3b542ea4af291ef56d5084fbf6410eb9c`: `git log 81cd03b3b..upstream/master`. `git merge-base HEAD upstream/master` should return that SHA.

## Migration renumbering

Fork migrations end at `0290_dizzy_ultragirl`. Upstream migrations added after the merge base were renamed in upstream order, and each got a new journal `when` greater than the previous entry. The final snapshot `meta/0306_snapshot.json` was regenerated from the merged schema. Its `prevId` is the fork `0290` snapshot id `08c7961c-45c7-4153-9cf2-8596730f337a`. The intermediate upstream snapshots were not kept: the repo prunes all but the newest snapshots.

| Upstream | Fork |
| --- | --- |
| 0284_petite_genesis | 0291_petite_genesis |
| 0285_heavy_oracle | 0292_heavy_oracle |
| 0286_complete_alice | 0293_complete_alice |
| 0287_serious_tinkerer | 0294_serious_tinkerer |
| 0288_glorious_jamie_braddock | 0295_glorious_jamie_braddock |
| 0289_drop_user_keyboard_shortcuts | 0296_drop_user_keyboard_shortcuts |
| 0290_browser_use_cloud | 0297_browser_use_cloud |
| 0291_conscious_secret_warriors | 0298_conscious_secret_warriors |
| 0292_powerful_devos | 0299_powerful_devos |
| 0293_broad_rattler | 0300_broad_rattler |
| 0294_chilly_marvel_apes | 0301_chilly_marvel_apes |
| 0295_public_captain_cross | 0302_public_captain_cross |
| 0296_stiff_thaddeus_ross | 0303_stiff_thaddeus_ross |
| 0297_foamy_swordsman | 0304_foamy_swordsman |
| 0298_connection_agent_instructions | 0305_connection_agent_instructions |
| 0299_absent_ser_duncan | 0306_absent_ser_duncan |

No upstream migration SQL had to be edited. Each one creates only objects the fork did not have, or already guards with `IF [NOT] EXISTS` or `duplicate_object`. Tests that read migration files by name were updated to the new names.

## Fork behaviour to keep

These fork features deliberately differ from upstream. Keep them when upstream touches the same code.

| Feature | Code | Tests | Why |
| --- | --- | --- | --- |
| Ancestor handoff mention: a comment that mentions the assignee of a parent or ancestor task (plain `@Name`, `@FirstName`, or `agent://` link) is forwarded to the nearest ancestor that agent owns and wakes it with `issue_commented` (`source: comment.ancestor_handoff`). Every other mention stays context only, as upstream `2de43fc90` intends. | `routeAncestorHandoffMentions` in `server/src/routes/issues.ts` (both comment paths), `server/src/services/issue-ancestor-handoff.ts` | `issue-ancestor-handoff.test.ts`, `issue-ancestor-handoff-routes.test.ts`, the `ancestor assignee handoff` block in `issue-update-comment-wakeup-routes.test.ts` | Owner decision 2026-10-08: workers hand results back up the tree (ZHA-723 → ZHA-379 incident). |

## Procedure

1. `git fetch upstream`. Create the work branch from `origin/main` in its own worktree; never use the main checkout.
2. Create a renamed copy of upstream: `git worktree add -b upstream-renamed <dir> upstream/master`. Copy in `scripts/fork/rename-to-paperclip-pro.mjs` from the fork, run it, remove the copied script, restore `pnpm-lock.yaml` and `skills-releases/`, then commit `chore(sync): apply fork package names to upstream`. That commit's parent is upstream, so the merge makes upstream an ancestor.
3. `git merge --no-ff --no-commit upstream-renamed`. Re-render conflicts with `git checkout --conflict=diff3`. Resolve them per file: keep every fork feature (see [Fork behaviour to keep](#fork-behaviour-to-keep)) and add the upstream change on top. Record each real fork-vs-upstream decision in `doc/upstream-sync/<date>-conflicts.md`.
4. Migrations: rename upstream migrations added after the merge base to the next free fork numbers, in upstream order. Rebuild `_journal.json` entries (idx, tag, increasing `when`). Drop conflicting upstream snapshots. Regenerate the newest snapshot from the merged schema with drizzle-kit `generateDrizzleJson`, using the last fork snapshot id as `prevId`. Gates: `check:migrations` and `src/migration-snapshot-drift.test.ts`.
5. Regenerate derived files; never hand-merge them: `pnpm install --no-frozen-lockfile` for the lockfile, `node scripts/ingest-app-definitions.mjs --definitions-only` (then revert JSON definition drift, keeping only `app-definitions.generated.ts`), `packages/paperclip-runner` `generate-protocol-manifest.mjs`, `generate-capability-contract.mjs`, `generate-capability-inventory.mjs` (via the skill inventory), and `pnpm generate:mcp-tools`.
6. Gates (no full suite locally): `pnpm -r typecheck`, `check:token-gates`, db `check:migrations`, `check:mcp-tools`, `check:module-boundaries`, `check-no-git-push`, `release-package-map check`, docs-lane suites, capability inventory/contract checks, ui build. Run targeted vitest on the files touched by conflicts plus `server/src/__tests__/openwa/*`, `stranded-reconciler-scope`, `openwa-authority`, `chat-channels.integration` and `packages/adapters/omp-local`.
7. Migration apply test on throwaway embedded Postgres: (a) all migrations from scratch, (b) restore the newest `~/.paperclip-pro/instances/default/data/backups/*.sql.gz` and apply the pending fork migrations.
8. Update this file with the new upstream SHA and the migration map.
