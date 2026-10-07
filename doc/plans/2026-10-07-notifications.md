# Notification sounds, browser notifications and Web Push

Status: approved scope (owner interview 2026-10-07)

## Outcome

When something lands in a board user's Inbox (approval, agent question/card, comment, assignment, task ready for review, failed run, join request), the user hears a sound chosen per notification kind while Paperclip is open, sees a browser/OS notification while the tab is in the background, and receives a Web Push notification when no Paperclip tab or PWA is open (Chrome, Firefox, Edge, installed PWA; iOS 16.4+ only when installed to the home screen).

## Decisions

| # | Decision |
|---|----------|
| D1 | Web Push included: notifications arrive with every tab closed. |
| D2 | Scope follows the Inbox: kinds `approval`, `question`, `comment`, `assignment`, `review`, `run_failed`, `join_request`. |
| D3 | Settings are per device/browser (localStorage). The device's enabled kinds are mirrored onto its push subscription so the server filters pushes per device. |
| D4 | Sounds: a bundled CC0 library (Kenney Interface Sounds) plus a per-device uploaded custom sound (stored in IndexedDB, audio only, max 512 KB). Each kind has its own default sound. |
| D5 | Custom sounds play only while Paperclip is open; closed-app pushes use the OS default sound (browser limitation). |

## Server

- One classifier `server/src/services/notifications/classify.ts`: maps a logged activity (action, entity, details, actor) to `PaperclipNotification | null` plus recipient user ids. Agent and system actors trigger notifications; a user's own actions never notify that user. Recipients: active board members of the company (`company_memberships`, principalType user) for `approval`, `question` (the addressee user when the card names one), `run_failed`, `join_request`; for `comment`, `assignment`, `review`: the users whose "mine" Inbox shows the issue (the `touchedByUserCondition` predicate: assignee user, creator user, users who commented on or otherwise touched it) plus users mentioned in the comment and the newly assigned user, with no fallback to all board members. Recipients are always limited to active company members and never include the actor.
- Dispatcher subscribed to company live events (`activity.logged`, `heartbeat.run.status` failed): publishes live event `notification.created` with `NotificationCreatedLivePayload`, and sends Web Push to each recipient's subscriptions whose `kinds` include the kind. Expired subscriptions (404/410) are deleted; other failures increment `failure_count`.
- VAPID key pair generated once and stored as an instance secret file (0600) under the instance data dir; subject = `mailto:` or the public base URL. `web-push` npm package.
- Routes (board users, self only): `GET /api/notifications/web-push/config` -> `WebPushConfig`; `PUT /api/notifications/web-push/subscription` (`upsertWebPushSubscriptionSchema`) -> `WebPushSubscriptionRecord`; `DELETE /api/notifications/web-push/subscription` (`deleteWebPushSubscriptionSchema`) -> 204; `POST /api/notifications/web-push/test` sends a test push to the caller's subscriptions.
- Push payload JSON: `{ notification: PaperclipNotification }`, no secrets, body capped at 300 chars.

## UI

- `LiveUpdatesProvider` handles `notification.created`: if the current user is a recipient and the kind is enabled on this device: play the kind's sound (once per key, across tabs via BroadcastChannel/leader), and when the document is hidden and no push subscription is active, show an OS notification via the service worker registration with `tag = key`.
- `ui/public/sw.js`: `push` listener shows the notification (tag = key, icon/badge from PWA icons, data.url) unless a visible client exists, in which case it posts the notification to clients and skips the OS popup; `notificationclick` focuses an existing client and navigates to `url`, else opens a window. Keep `__PAPERCLIP_BUILD_ID__`.
- Profile settings > Notifications (per device): master on/off, permission state + request button, "Push when Paperclip is closed" toggle (subscribe/unsubscribe), per-kind toggle + sound picker + preview, volume, custom sound upload/remove, test notification, iOS install hint.
- Sounds in `ui/public/sounds/*.ogg` (+ `.mp3` fallback for Safari) with `LICENSE.txt` (CC0, source URL).

## Acceptance criteria

1. An agent creating an approval, an ask_user_questions card, a comment on the user's issue, an assignment to the user, moving the user's issue to in_review/done, a failed run, or a join request produces exactly one `notification.created` for the right recipients; the user's own actions produce none.
2. With Paperclip open and visible, the kind's configured sound plays once even with several tabs open.
3. With the tab hidden, an OS notification appears once; clicking it focuses Paperclip on the target URL.
4. With every tab closed and push enabled, a push notification arrives (Chrome/Firefox desktop, Android Chrome, installed PWA), click opens the URL.
5. Disabling a kind on a device stops both its sound and its pushes on that device only.
6. Custom sound upload plays for its kind; files that are not audio or exceed 512 KB are rejected.
7. Expired subscriptions are pruned on 404/410.

## Not doing

Server-synced settings, quiet hours, email/WhatsApp delivery of these notifications, app icon badge counts, per-company sound sets.
