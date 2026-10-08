---
title: Files and Storage
summary: Upload size limit and automatic attachment cleanup
---

Instance admins manage file limits and cleanup in **Instance Settings > General > Files and storage**.

## Upload size limit

The limit applies to every upload (task attachments, images, company logos, case files) and to files that chat channels and agents hand to Paperclip.

- Set a whole number of megabytes from 1 to 500. A change takes effect on the next upload, without a restart.
- Leave the field blank to use the default: `PAPERCLIP_ATTACHMENT_MAX_BYTES` when the server sets it, otherwise 100 MB.
- The browser rejects a file above the limit before uploading it and shows "File is larger than the <limit> limit". The server answers `413` with the same message.
- A reverse proxy can stop a large request first. Cloudflare Free and Pro reject request bodies over 100 MB with an HTML `413`; the UI shows the same friendly message in that case.

Uploads stream to `data/tmp/uploads` inside the instance data directory and are then moved into storage, so a large file does not sit in server memory. Downloads stream from storage and support byte ranges.

## Automatic cleanup

Cleanup is off by default. Each rule only removes files that are older than its age setting:

| Rule | What it removes | Setting |
|---|---|---|
| Orphaned files in storage | Stored files under a company with no matching upload record | Remove unused files after (1-365 days, default 7) |
| Unreferenced uploads | Uploads no task, comment, document, interaction, work product, chat message, goal, project, company, approval, profile or agent setting refers to | Same as above |
| Attachments of closed tasks | Attachments of tasks done or cancelled longer ago than the setting (by completion or cancel time) | Off by default; 7-3650 days, default 90 |

Cleanup never removes:

- an attachment still listed on its task (unless the closed-task rule applies),
- a file that backs a deliverable (work product),
- a file referenced from a task that is not closed,
- images uploaded to agent instructions,
- files outside company storage, such as generated avatars and run logs.

Attachments uploaded from the comment composer but never sent look the same as attachments added in the task's attachment panel, so cleanup leaves them alone.

A removed file keeps its record as a tombstone. Its links and images show "File removed by retention (<date>)", and the content URL answers `410 Gone` with `{ "code": "attachment_purged", "purgedAt": "<ISO>" }`.

**Preview** shows how many files and bytes each rule would remove with the values in the form, and deletes nothing. **Run now** asks for confirmation, then runs the saved settings once, even while automatic cleanup is off. While cleanup is on, the server runs it once a day. Each run writes an `attachment.retention_purged` entry to the [activity log](/guides/board-operator/activity-log) of every company it touched.

## API

All three endpoints require an instance admin.

```
GET  /api/instance/attachment-retention          -> { settings, lastRun }
POST /api/instance/attachment-retention/preview  { settings? } -> report (nothing deleted)
POST /api/instance/attachment-retention/run      -> report, 409 while another run is active
```

A report lists `rules[]` with `rule`, `count`, `bytes` and `sampleIds`, plus `totalCount`, `totalBytes` and `failedCount`. The settings live in `PATCH /api/instance/settings/general` as `attachmentMaxMegabytes` and `attachmentRetention`.
