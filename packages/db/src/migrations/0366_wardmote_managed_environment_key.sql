DROP INDEX IF EXISTS "environments_managed_sandbox_idx";--> statement-breakpoint
UPDATE "environments"
SET "metadata" = ("metadata" - 'managedByPaperclip') || jsonb_build_object('managedByWardmote', "metadata" -> 'managedByPaperclip')
WHERE "metadata" ? 'managedByPaperclip' AND NOT ("metadata" ? 'managedByWardmote');--> statement-breakpoint
UPDATE "environments"
SET "metadata" = "metadata" - 'managedByPaperclip'
WHERE "metadata" ? 'managedByPaperclip' AND "metadata" ? 'managedByWardmote';--> statement-breakpoint
UPDATE "environments"
SET "description" = 'Default execution environment for Wardmote runs on this machine.'
WHERE "description" = 'Default execution environment for Paperclip runs on this machine.';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "environments_managed_sandbox_idx"
  ON "environments" USING btree ("driver")
  WHERE "driver" = 'sandbox' AND ("metadata" ->> 'managedByWardmote')::boolean = true;
