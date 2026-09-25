# Company Skills Workflow

Use this reference when a board user, CEO, or manager asks you to find a skill, install it into the company library, or assign it to an agent.

**Toolset:** `paperclipListSkills` is in the default `core` toolset. Every other tool on this page is in the `extended` toolset: it is available when the operator enables `PAPERCLIP_MCP_TOOLSETS=core,extended`; otherwise use `paperclipApiRequest`. `companyId` is optional on company-scoped tools and defaults to your company.

## What Exists

- App-shipped catalog: a curated set of company skills in `@tickernelz/paperclip-pro-skills-catalog`, browseable and installable without leaving Paperclip.
- Company skill library: install, inspect, update, audit, reset, and read company skills for the whole company.
- Agent skill assignment: add or remove company skills on an existing agent.
- Hire/create composition: pass `desiredSkills` when creating or hiring an agent so the same assignment model applies immediately.

The canonical model is:

1. add the skill to the company library — either from the app catalog (`paperclipInstallCatalogSkill`), an external source (`paperclipImportSkill`), or a managed local skill (`paperclipCreateSkill` / `paperclipCreateSkillScanProject`)
2. attach the company skill to the agent (`paperclipSyncAgentSkill`)
3. optionally do step 2 during hire/create with `desiredSkills`

Catalog install ≠ agent attach. Installing a catalog skill only adds the row to
`company_skills`. The agent will not use it until you sync the agent's desired
set.

## Permission Model

- Company skill reads: any same-company actor
- Company skill mutations: open to same-company actors by default. Missing `skills:create` grants and `canCreateSkills` settings do not deny ordinary skill work; only an explicit company skill policy restriction does. Core safety and company-boundary checks always remain enforced.
- Agent skill assignment: same permission model as updating that agent
- Team installs continue to require `agents:create` because they import or create agents in addition to attaching skills.

## Tools

App-shipped catalog (read-only browse + company install):

- `paperclipGetSkillCatalog` — browse catalog entries; each entry reports its `kind` (`bundled` or `optional`)
- `paperclipGetSkillCatalogByCatalogId` — `{ "catalogId": "<catalog-id>" }`
- resolving a catalog ref and reading catalog files have no dedicated tool: use `paperclipApiRequest` with `method: "GET"`, `path: "/skills/catalog/ref?ref=<id|key|slug>"` or `path: "/skills/catalog/<catalogId>/files?path=SKILL.md"`
- `paperclipInstallCatalogSkill` — install a catalog skill into the company

Company library:

- `paperclipListSkills` — the installed company skill library
- `paperclipGetSkill` — `{ "skillId": "<skill-id>" }`
- reading a company skill file has no dedicated tool: use `paperclipApiRequest` with `method: "GET"`, `path: "/companies/<companyId>/skills/<skillId>/files?path=SKILL.md"`
- `paperclipCreateSkill` — managed local create
- `paperclipImportSkill` — import from an external source
- `paperclipCreateSkillScanProject` — discover skills in the company project workspaces
- `paperclipListSkillUpdateStatus` / `paperclipInstallUpdateSkill` — check and apply an update
- `paperclipAuditSkill`, `paperclipResetSkill`, `paperclipDeleteSkill`

Agent attach and hire/create composition:

- `paperclipListAgentSkills` — `{ "id": "<agent-id>" }`
- `paperclipSyncAgentSkill` — attach or detach company skills on an agent
- `paperclipCreateAgentHire` — hire with `desiredSkills`
- `paperclipCreateAgent` — direct create with `desiredSkills`

## Install A Skill Into The Company

Two paths cover the common cases:

1. **App-shipped catalog** (preferred when the right skill exists in the
   bundled/optional catalog) — browse it first, then install with
   `paperclipInstallCatalogSkill`. No external network fetch happens.
2. **External source** (skills.sh, GitHub, local path, or URL) — use
   `paperclipImportSkill`.

### App-shipped catalog

Browse, inspect, and install catalog skills before reaching for an external
source. Bundled skills are the curated defaults for any company; optional
skills are role- or domain-specific.

Browse with `paperclipGetSkillCatalog`, inspect one entry with
`paperclipGetSkillCatalogByCatalogId`, then install:

```json
{
  "catalogSkillId": "paperclipai:bundled:software-development:github-pr-workflow"
}
```

The install result records provenance (`catalogId`, `catalogKey`,
`packageVersion`, `originHash`) on the company skill so update/audit/reset
flows know the pinned origin. `force: true` may replace a same-key
catalog-managed skill but never bypasses hard-stop audit findings.

### External source import

Import using a **skills.sh URL**, a key-style source string, a GitHub URL, or a local path.

### Source types (in order of preference)

| Source format | Example | When to use |
|---|---|---|
| **skills.sh URL** | `https://skills.sh/google-labs-code/stitch-skills/design-md` | When a user gives you a `skills.sh` link. This is the managed skill registry — **always prefer it when available**. |
| **Key-style string** | `google-labs-code/stitch-skills/design-md` | Shorthand for the same skill — `org/repo/skill-name` format. Equivalent to the skills.sh URL. |
| **GitHub URL** | `https://github.com/vercel-labs/agent-browser` | When the skill is in a GitHub repo but not on skills.sh. |
| **Local path** | `/abs/path/to/skill-dir` | When the skill is on disk (dev/testing only). |

**Critical:** If a user gives you a `https://skills.sh/...` URL, use that URL or its key-style equivalent (`org/repo/skill-name`) as the `source`. Do **not** convert it to a GitHub URL — skills.sh is the managed registry and the source of truth for versioning, discovery, and updates.

### Example: skills.sh import (preferred)

`paperclipImportSkill`:

```json
{ "source": "https://skills.sh/google-labs-code/stitch-skills/design-md" }
```

Or equivalently using the key-style string:

```json
{ "source": "google-labs-code/stitch-skills/design-md" }
```

### Example: GitHub import

```json
{ "source": "https://github.com/vercel-labs/agent-browser" }
```

You can also use source strings such as:

- `google-labs-code/stitch-skills/design-md`
- `vercel-labs/agent-browser/agent-browser`
- `npx skills add https://github.com/vercel-labs/agent-browser --skill agent-browser`

If the task is to discover skills from the company project workspaces first, call `paperclipCreateSkillScanProject` with no arguments beyond the optional `companyId`.

## Inspect What Was Installed

Call `paperclipListSkills` for the library, then `paperclipGetSkill` with the
`skillId` for one entry. To read its `SKILL.md`, use `paperclipApiRequest` with
`method: "GET"`, `path: "/companies/<companyId>/skills/<skillId>/files?path=SKILL.md"`.

## Assign Skills To An Existing Agent

`desiredSkills` accepts:

- exact company skill key
- exact company skill id
- exact slug when it is unique in the company

The server persists canonical company skill keys.

`paperclipSyncAgentSkill` requires a merge mode:

- `add` adds the named skills and keeps every other assignment.
- `remove` removes only the named skills.
- `replace` overwrites the complete desired skill set. Use it only after explicit confirmation.

```json
{
  "id": "<agent-id>",
  "mode": "add",
  "desiredSkills": ["vercel-labs/agent-browser/agent-browser"]
}
```

If you need the current state first, call `paperclipListAgentSkills` with
`{ "id": "<agent-id>" }`.

## Include Skills During Hire Or Create

Use the same company skill keys or references in `desiredSkills` when hiring with `paperclipCreateAgentHire`:

```json
{
  "name": "QA Browser Agent",
  "role": "qa",
  "adapterType": "codex_local",
  "adapterConfig": { "cwd": "/abs/path/to/repo" },
  "desiredSkills": ["agent-browser"]
}
```

For direct create without approval, pass the same arguments to `paperclipCreateAgent`.

## Notes

- Built-in Paperclip runtime skills are still added automatically when required by the adapter.
- If a reference is missing or ambiguous, the tool returns a `422` error and nothing was installed or assigned.
- Prefer linking back to the relevant issue, approval, and agent when you comment about skill changes.
- Whole-package company import/export has no dedicated tool. Use `paperclipApiRequest` with `method: "POST"` and one of `path: "/companies/<companyId>/imports/preview"`, `path: "/companies/<companyId>/imports/apply"`, `path: "/companies/<companyId>/exports/preview"`, `path: "/companies/<companyId>/exports"`.
- Use skill-only import when the task is specifically to add a skill to the company library without importing the surrounding company/team/package structure.
