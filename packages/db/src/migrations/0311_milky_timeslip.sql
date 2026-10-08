ALTER TABLE "assets" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "attachment_retention_last_run" jsonb;