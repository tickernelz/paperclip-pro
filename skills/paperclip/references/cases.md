# Cases

Cases are agent-owned work records for durable outputs such as blog posts,
research packets, release notes, incidents, QA runs, or generated asset sets.
They are company-scoped and live beside issues: issues coordinate work, while
cases preserve the structured object an agent is producing.

Cases are experimental and must be enabled with `experimental.enableCases`.
If a case tool reports `Cases are disabled`, stop and report that the operator
must enable cases before the skill can use this surface.

The case tools are in the `extended` toolset: they are available when the
operator enables `PAPERCLIP_MCP_TOOLSETS=core,extended`. When they are not
loaded, use `paperclipApiRequest` for the same operations. Every tool below
takes `companyId` only where noted; it defaults to the agent's company.

## Core Model

A case has:

- `identifier`: server-assigned display id such as `PAP-C42`
- `caseType`: skill-owned type such as `blog_post`, `image_assets`, or `incident`
- `key`: optional deterministic upsert key inside `(companyId, caseType)`
- `title` and optional `summary`
- `status`: `draft`, `in_progress`, `in_review`, `approved`, `done`, or `cancelled`
- `fields`: JSON object owned by the skill using the case
- `parentCaseId`: optional parent case for child work
- documents, attachments, issue links, labels, and events

Use deterministic `caseType` + `key` when a skill may be retried. Repeating
`paperclipCreateCase` with the same `caseType` and `key` upserts the same case
instead of creating a duplicate.

## Upsert Semantics

`paperclipCreateCase` creates or upserts a case:

```json
{
  "caseType": "blog_post",
  "key": "launch-announcement",
  "title": "Launch announcement",
  "summary": "Draft launch post for operators.",
  "status": "draft",
  "fields": {
    "slug": "launch-announcement",
    "target_audience": "operators"
  }
}
```

The result is the case record, whether it was newly created or an existing
`(caseType, key)` case that was updated. Read `identifier` and `id` from it for
the follow-up calls.

Field behavior on upsert:

- `title` is required and replaces the previous title.
- `projectId`, `summary`, `status`, `fields`, and `parentCaseId` replace the
  previous value when present.
- Omitted optional values preserve the previous value during upsert.
- `fields` is replaced as a whole object when provided. It is not deep-merged.
  Send the complete desired JSON object each time.
- Concurrent retries with the same `(caseType, key)` converge to one case.

Do not use a random `key` for retryable skills. Use a stable content slug,
external id, source URL hash, or parent-derived request key.

## Read And Search

Get a case by UUID or identifier with `paperclipGetCase`:

```json
{ "caseId": "PAP-C42" }
```

List cases for a company with `paperclipListCases`:

```json
{ "type": "blog_post", "status": "active", "q": "launch" }
```

Useful arguments:

- `type` / `types`: exact `caseType`
- `status` / `statuses`: exact lifecycle status, or `active` for non-terminal cases
- `projectId` / `project`: project UUID
- `labelId` / `label`: label UUID
- `parent`: parent case filter
- `q`: identifier, title, summary, or key search
- `limit`: 1-200, default 100

## Documents

Use case documents for rich bodies such as drafts, briefs, reports, or plans.
`paperclipSetCaseDocument` takes the case, the document `key`, and the body:

```json
{
  "caseId": "PAP-C42",
  "key": "body",
  "title": "Launch announcement body",
  "format": "markdown",
  "body": "# Launch announcement\n\nDraft copy...",
  "changeSummary": "Initial draft"
}
```

Updating an existing case document requires `baseRevisionId`:

```json
{
  "caseId": "PAP-C42",
  "key": "body",
  "baseRevisionId": "latest-revision-uuid",
  "body": "Updated body"
}
```

If the tool reports `stale_base_revision`, refetch the case detail, read the
latest document revision id, merge intentionally, and retry with that
`baseRevisionId`. A failed call wrote nothing — do not treat it as saved.

## Fields

Each skill owns the schema of `fields` for the `caseType` it creates. Keep fields
small, typed, and stable enough for other agents to inspect.

Examples:

```json
{
  "slug": "launch-announcement",
  "target_audience": "operators",
  "publish_url": "https://example.com/blog/launch-announcement"
}
```

Patch fields or status with `paperclipUpdateCase`:

```json
{
  "caseId": "PAP-C42",
  "status": "in_review",
  "fields": {
    "slug": "launch-announcement",
    "target_audience": "operators",
    "publish_url": "https://example.com/blog/launch-announcement"
  }
}
```

Remember: `fields` replaces the whole object when present.

## Issue Links

Link cases to issues explicitly when needed with `paperclipCreateCaseLink`:

```json
{
  "id": "PAP-C42",
  "issueId": "issue-uuid",
  "role": "reference"
}
```

Roles:

- `origin`: the issue/run that created the case
- `work`: an issue/run that changed the case
- `reference`: related issue context

Agent run writes auto-link the run's issue when Paperclip can resolve it from
the run context the tools carry. Creation/upsert writes use `origin`; later
document, patch, and attachment writes use `work` when no link already exists.
You do not need to manually link the current issue before writing the case.

## Child Cases

Create child cases with `paperclipCreateCase` by setting `parentCaseId` to the
parent case UUID.

```json
{
  "caseType": "image_assets",
  "key": "launch-announcement:hero-images",
  "title": "Hero images for launch announcement",
  "parentCaseId": "parent-case-uuid",
  "fields": {
    "required_assets": ["hero", "social-card"]
  }
}
```

Use child cases when the output has independently inspectable pieces or when
another agent can work on a bounded part without editing the parent case body.

## Attachments

Case attachments are a multipart file upload, and multipart has no MCP tool.
Upload generated files as issue attachments with the upload helper described in
`artifacts.md`, then connect them to the case with `paperclipCreateCaseLink`
using the issue that holds the files. The case then carries the link, and the
issue carries the inspectable file.

## Lifecycle

Use the lifecycle consistently:

- `draft`: case exists but useful work has not started
- `in_progress`: an agent is actively producing or revising it
- `in_review`: ready for reviewer, board, or downstream approval
- `approved`: accepted but not finally shipped or archived
- `done`: complete and no further action remains
- `cancelled`: intentionally abandoned

Terminal statuses are `done` and `cancelled`; setting either records
`completedAt`. Moving back to a non-terminal status clears `completedAt`.

## Worked Blog Post Example

Create or upsert the parent blog post with `paperclipCreateCase`:

```json
{
  "caseType": "blog_post",
  "key": "paperclip-cases-launch",
  "title": "Introducing Paperclip Cases",
  "summary": "Blog post explaining the cases surface for agent outputs.",
  "status": "in_progress",
  "fields": {
    "slug": "paperclip-cases-launch",
    "target_audience": "AI company operators",
    "publish_url": null
  }
}
```

Write the body with `paperclipSetCaseDocument`:

```json
{
  "caseId": "PAP-C42",
  "key": "body",
  "title": "Introducing Paperclip Cases",
  "format": "markdown",
  "body": "# Introducing Paperclip Cases\n\n..."
}
```

Create the child image-assets case with `paperclipCreateCase`:

```json
{
  "caseType": "image_assets",
  "key": "paperclip-cases-launch:image-assets",
  "title": "Image assets for Introducing Paperclip Cases",
  "parentCaseId": "parent-case-uuid",
  "status": "in_progress",
  "fields": {
    "slug": "paperclip-cases-launch",
    "required_assets": ["hero", "social-card"],
    "publish_url": null
  }
}
```

Attach the generated assets to the child's linked issue, then patch both cases
as they move through review with `paperclipUpdateCase`:

```json
{
  "caseId": "PAP-C42",
  "status": "in_review",
  "fields": {
    "slug": "paperclip-cases-launch",
    "target_audience": "AI company operators",
    "publish_url": "https://example.com/blog/paperclip-cases-launch"
  }
}
```

If the same skill retries the example with the same keys, it updates the parent
and child cases rather than creating duplicates.
