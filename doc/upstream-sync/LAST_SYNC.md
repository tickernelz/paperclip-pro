# Last upstream sync

| Field | Value |
| --- | --- |
| Upstream repository | https://github.com/paperclipai/paperclip |
| Upstream branch | `master` |
| Upstream commit merged | `e733bddc45e00efb1819fffa8677f7b0d07802c5` |
| Previous merge base | `81cd03b3b542ea4af291ef56d5084fbf6410eb9c` |
| Date | 2026-10-11 |
| Fork branch | `sync/upstream-20261011` (from `origin/main` `a814ecf73`) |
| Fork merge commit | `MERGE_COMMIT_PLACEHOLDER` (parents: fork `a814ecf73`, upstream-renamed `d350bc9f6` whose parent is upstream `e733bddc4`) |
| Conflict decisions | [2026-10-11-conflicts.md](2026-10-11-conflicts.md) |

The next sync starts from `e733bddc45e00efb1819fffa8677f7b0d07802c5`: `git log e733bddc4..upstream/master`. `git merge-base HEAD upstream/master` should return that SHA.

## Migration renumbering

Fork migrations end at `0314_chilly_triton` (snapshot id `2a5bfff1-10bb-4883-96d8-741a6b14fcef`). Upstream migrations added after the merge base were renamed in upstream order to `0315`..`0347`, each keeping its upstream adjective suffix and a new journal `when` strictly greater than the previous entry. The final snapshot `meta/0347_snapshot.json` was regenerated from the merged schema; its `prevId` is the fork `0314` snapshot id `2a5bfff1-10bb-4883-96d8-741a6b14fcef` and its own id is `0f9388f6-cfb7-498e-9106-dd562ec6474a`. The colliding upstream snapshots were not kept; the repo prunes all but the newest snapshots. The last upstream migration taken is `0332_little_night_nurse` (renamed `0347_little_night_nurse`).

| Upstream | Fork |
| --- | --- |
| 0300_chunky_chamber | 0315_chunky_chamber |
| 0301_lumpy_maria_hill | 0316_lumpy_maria_hill |
| 0302_colossal_otto_octavius | 0317_colossal_otto_octavius |
| 0303_supreme_garia | 0318_supreme_garia |
| 0304_curvy_shadow_king | 0319_curvy_shadow_king |
| 0305_chubby_vin_gonzales | 0320_chubby_vin_gonzales |
| 0306_familiar_titania | 0321_familiar_titania |
| 0307_cool_naoko | 0322_cool_naoko |
| 0308_whole_steel_serpent | 0323_whole_steel_serpent |
| 0309_loving_the_hood | 0324_loving_the_hood |
| 0310_agent_commentary | 0325_agent_commentary |
| 0311_mcp_file_transfers | 0326_mcp_file_transfers |
| 0312_easy_eternity | 0327_easy_eternity |
| 0313_private_task_access | 0328_private_task_access |
| 0314_private_task_draft_assets | 0329_private_task_draft_assets |
| 0315_rapid_emma_frost | 0330_rapid_emma_frost |
| 0316_premium_slayback | 0331_premium_slayback |
| 0317_messy_famine | 0332_messy_famine |
| 0318_strong_blacklash | 0333_strong_blacklash |
| 0319_heavy_captain_midlands | 0334_heavy_captain_midlands |
| 0320_daily_onslaught | 0335_daily_onslaught |
| 0321_acoustic_human_fly | 0336_acoustic_human_fly |
| 0322_reflective_kree | 0337_reflective_kree |
| 0323_petite_shockwave | 0338_petite_shockwave |
| 0324_long_franklin_storm | 0339_long_franklin_storm |
| 0325_aberrant_machine_man | 0340_aberrant_machine_man |
| 0326_blushing_screwball | 0341_blushing_screwball |
| 0327_sad_proteus | 0342_sad_proteus |
| 0328_chunky_mentallo | 0343_chunky_mentallo |
| 0329_free_wolf_cub | 0344_free_wolf_cub |
| 0330_spooky_white_tiger | 0345_spooky_white_tiger |
| 0331_panoramic_spyke | 0346_panoramic_spyke |
| 0332_little_night_nurse | 0347_little_night_nurse |

No upstream migration SQL had to be edited. Each one creates only objects the fork did not have, or already guards with `IF [NOT] EXISTS` or `duplicate_object`. `pnpm db:generate` emits only `meta/0347_snapshot.json` and no new SQL.

## Procedure

1. `git fetch upstream`. Create the work branch from `origin/main` in its own worktree; never use the main checkout.
2. Create a renamed copy of upstream: `git worktree add -b upstream-renamed <dir> upstream/master`. Copy in `scripts/fork/rename-to-paperclip-pro.mjs` from the fork, run it, remove the copied script, restore `pnpm-lock.yaml` and `skills-releases/`, then commit `chore(sync): apply fork package names to upstream`. That commit's parent is upstream, so the merge makes upstream an ancestor.
3. `git merge --no-ff --no-commit upstream-renamed`. Re-render conflicts with `git checkout --conflict=diff3`. Resolve them per file: keep every fork feature (see [2026-10-11-conflicts.md](2026-10-11-conflicts.md)) and add the upstream change on top.
4. Migrations: rename upstream migrations added after the merge base to the next free fork numbers, in upstream order. Rebuild `_journal.json` entries (idx, tag, increasing `when`). Drop conflicting upstream snapshots. Regenerate the newest snapshot from the merged schema with drizzle-kit `generate`, using the last fork snapshot id as `prevId`; `generate` must then report "No schema changes". Gates: `check:migrations`.
5. Regenerate derived files; never hand-merge them: `pnpm install --no-frozen-lockfile` for the lockfile, `pnpm generate:mcp-tools`, and the capability inventory (`packages/paperclip-runner/scripts/generate-capability-inventory.mjs`, which needs `PAPERCLIP_EVALS_ROOT`).
6. Gates (no full suite locally): per-package `tsc --noEmit`, `check:token-gates`, db `check:migrations`, `check:mcp-tools`, `check:module-boundaries`, `check-no-git-push`, `release-package-map check`, docs-lane suites. Run targeted vitest on the files touched by conflicts plus `server/src/__tests__/openwa/*`, the heartbeat suites, and `packages/adapters/omp-local`.
7. Update this file with the new upstream SHA and the migration map.

## Prior syncs

- 2026-10-06: upstream `81cd03b3b542ea4af291ef56d5084fbf6410eb9c`, merge commit `dde142577813f8a0207e1fe02c8a9a760301cfcf`, migrations `0284`..`0299` -> `0291`..`0306`. See [2026-10-06-conflicts.md](2026-10-06-conflicts.md).
