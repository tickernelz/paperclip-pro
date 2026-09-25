---
name: release
description: >
  Coordinate a full Paperclip release across engineering verification, npm,
  GitHub, smoke testing, and announcement follow-up. Use when leadership asks
  to ship a release, not merely to discuss versioning.
---

# Release Coordination Skill

Run the full Paperclip maintainer release workflow, not just an npm publish.

This skill coordinates:

- release changelog drafting via `release-changelog`
- Docker smoke testing via `scripts/docker-onboard-smoke.sh`
- the single dispatched release run
- GitHub Release creation
- website / announcement follow-up tasks
- release-content Cases dogfood: a top-level `release` case with child
  `blog_post` and `tweet_storm` cases, all linked to the release issue/run

## Trigger

Use this skill when leadership asks for:

- "do a release"
- "ship the release"
- "cut the release"

## Preconditions

Before proceeding, verify all of the following:

1. `.agents/skills/release-changelog/SKILL.md` exists and is usable.
2. The repo working tree is clean, including untracked files.
3. There is at least one commit since the last `v*` tag.
4. The candidate SHA has passed the verification gate or is about to.
5. If manifests changed, the CI-owned `pnpm-lock.yaml` refresh is already merged on `master`.
6. npm publish rights are available through GitHub trusted publishing, or through local npm auth for emergency/manual use.
7. If running through Paperclip, you have issue context for status updates and follow-up task creation.

If any precondition fails, stop and report the blocker.

## Inputs

Collect these inputs up front:

- the commit on `main` to release
- whether the run is a dry run or a live publish
- release issue / company context for website and announcement follow-up

## Step 0 — Release Model

One workflow releases everything: **Release**
(`.github/workflows/release.yml`), dispatch-only, one job, no tests.
`docs/fork/OPERATIONS.md` section 9 is the operator reference.

1. versions are `YYYY.MDD.P` from the UTC date, with `P` resolved to the next
   patch not already on npm for `@tickernelz/paperclip-pro`
2. every package publishes under the `next` dist-tag first
3. `latest` moves onto the version only after npm exposes the whole set
4. the release commit is tagged `vYYYY.MDD.P` and gets a GitHub release whose
   notes are generated since the previous `v*` tag
5. the run is idempotent: rerunning the same version finishes a partial set

## Step 1 — Choose the Commit

Release from `main`. Record the SHA the workflow will run on and confirm the
main CI is green for it.

Resolve the version the run would pick:

```bash
./scripts/release.sh --print-version
npm view @tickernelz/paperclip-pro version
```

## Step 2 — Draft the Changelog

Invoke `release-changelog` for the human-facing notes. The GitHub release
itself carries generated commit notes, so the changelog is editorial copy, not
the mechanical list.

## Step 3 — Dry Run

```bash
gh workflow run release.yml --repo tickernelz/paperclip-pro --ref main \
  -f dry_run=true -f auth=token -f version=
```

Read the run log: every package must reach a publish preview, and no package
may report unresolved `workspace:` specs.

## Step 4 — Publish

```bash
gh workflow run release.yml --repo tickernelz/paperclip-pro --ref main \
  -f dry_run=false -f auth=token -f version=
```

Use `auth=oidc` only once every package has a trusted publisher; the `latest`
promotion still needs `NPM_TOKEN` because npm OIDC does not authenticate
`npm dist-tag add`.

## Step 5 — Confirm

```bash
npm view @tickernelz/paperclip-pro version
gh release view "v$(./scripts/release.sh --print-version)" --repo tickernelz/paperclip-pro
```

A failed run is resumable: dispatch the same `version` again and it skips what
already landed.

## Step 6 — Finish the Other Surfaces

Create or verify follow-up work for:

- website changelog publishing
- launch post / social announcement
- release summary in Paperclip issue context

These should reference the released version and its GitHub release.

## Step 7 — Emit Release-Content Cases

When Cases are enabled, every stable release-content run must materialize a
deterministic case tree. This is part of the release dogfood path, not an
optional artifact. If the API returns `403 Cases are disabled`, stop and report
that the operator must enable `experimental.enableCases`.

Use the current release issue's `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_API_URL`,
`PAPERCLIP_API_KEY`, and `PAPERCLIP_RUN_ID`. Include `X-Paperclip-Run-Id` on
all writes so the case activity feed can attribute the run back to the issue.

Create or upsert the parent `release` case first:

```http
POST /api/companies/:companyId/cases
{
  "caseType": "release",
  "key": "paperclip-release:vYYYY.MDD.P",
  "title": "Paperclip vYYYY.MDD.P release",
  "summary": "Stable release content package for Paperclip vYYYY.MDD.P.",
  "status": "in_progress",
  "fields": {
    "schema_version": 1,
    "version": "vYYYY.MDD.P",
    "release_date": "YYYY-MM-DD",
    "source_ref": "git-sha-or-ref",
    "stable": true,
    "channels": ["changelog", "blog_post", "tweet_storm"],
    "artifacts": {
      "changelog_path": "releases/vYYYY.MDD.P.md",
      "github_release_url": null
    },
    "verification": {
      "typecheck": "unknown",
      "tests": "unknown",
      "build": "unknown",
      "smoke": "unknown"
    },
    "notes": null
  }
}
```

The `fields` schema intentionally uses all generic JSON value types: strings,
numbers, booleans, arrays, objects, and nulls. Send the complete fields object on
each upsert because case fields replace as a whole object.

Write the parent body document immediately after the upsert:

```http
PUT /api/cases/:releaseCaseId/documents/body
{
  "title": "Paperclip vYYYY.MDD.P release body",
  "format": "markdown",
  "body": "# Paperclip vYYYY.MDD.P\n\nRelease summary and links...",
  "changeSummary": "Initial release case body"
}
```

Then create or upsert these child cases with `parentCaseId` set to the release
case id:

- `blog_post`, key `paperclip-release:vYYYY.MDD.P:blog-post`, status
  `in_progress`, body document key `body`
- `tweet_storm`, key `paperclip-release:vYYYY.MDD.P:tweet-storm`, status
  `in_progress`, body document key `body`

Use deterministic keys exactly so rerunning the release-content flow upserts the
same three cases instead of duplicating them. After the child body documents are
written, list the resulting case identifiers and links in the release issue and
in the parent acceptance issue when one exists.

## Failure Handling

If the release is bad:

- fix forward on `main` and dispatch a new version, never rewrite a published one

If stable npm publish succeeds but tag push or GitHub release creation fails:

- fix the git/GitHub issue immediately from the same release result
- do not republish the same version

If `latest` is bad after stable publish:

```bash
./scripts/rollback-latest.sh <last-good-version>
```

Then fix forward with a new stable release.

## Output

When the skill completes, provide:

- released SHA and version
- stable version, if promoted
- verification status
- npm status
- smoke-test status
- git tag / GitHub Release status
- website / announcement follow-up status
- release-content case tree links: parent `release` case plus `blog_post` and
  `tweet_storm` children
- rollback recommendation if anything is still partially complete
