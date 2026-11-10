ALTER TABLE "chat_owner_approval_requests" DROP CONSTRAINT "chat_owner_approval_requests_resolved_via_check";--> statement-breakpoint
ALTER TABLE "chat_owner_grants" DROP CONSTRAINT "chat_owner_grants_approved_via_check";--> statement-breakpoint
ALTER TABLE "issue_autonomy_windows" DROP CONSTRAINT "issue_autonomy_windows_granted_via_check";--> statement-breakpoint
UPDATE "chat_owner_approval_requests" SET "resolved_via" = 'wardmote' WHERE "resolved_via" = 'paperclip';--> statement-breakpoint
UPDATE "chat_owner_grants" SET "approved_via" = 'wardmote' WHERE "approved_via" = 'paperclip';--> statement-breakpoint
UPDATE "issue_autonomy_windows" SET "granted_via" = 'wardmote' WHERE "granted_via" = 'paperclip';--> statement-breakpoint
UPDATE "issue_thread_interaction_owner_relays" SET "channel" = 'wardmote' WHERE "channel" = 'paperclip';--> statement-breakpoint
UPDATE "user" SET "email" = 'local@wardmote.local' WHERE "id" = 'local-board' AND "email" = 'local@paperclip.local';--> statement-breakpoint
ALTER TABLE "chat_owner_approval_requests" ADD CONSTRAINT "chat_owner_approval_requests_resolved_via_check" CHECK ("chat_owner_approval_requests"."resolved_via" is null or "chat_owner_approval_requests"."resolved_via" in ('whatsapp', 'wardmote'));--> statement-breakpoint
ALTER TABLE "chat_owner_grants" ADD CONSTRAINT "chat_owner_grants_approved_via_check" CHECK ("chat_owner_grants"."approved_via" in ('whatsapp', 'wardmote'));--> statement-breakpoint
ALTER TABLE "issue_autonomy_windows" ADD CONSTRAINT "issue_autonomy_windows_granted_via_check" CHECK ("issue_autonomy_windows"."granted_via" in ('whatsapp', 'wardmote'));