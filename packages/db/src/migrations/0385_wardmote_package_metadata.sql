UPDATE "agents"
SET "metadata" = ("metadata" - 'paperclip') || jsonb_build_object('wardmote', "metadata"->'paperclip')
WHERE "metadata" ? 'paperclip' AND NOT "metadata" ? 'wardmote';--> statement-breakpoint
UPDATE "agents"
SET "metadata" = "metadata" - 'paperclip'
WHERE "metadata" ? 'paperclip' AND "metadata" ? 'wardmote';--> statement-breakpoint
UPDATE "company_skills"
SET "metadata" = ("metadata" - 'paperclip') || jsonb_build_object('wardmote', "metadata"->'paperclip')
WHERE "metadata" ? 'paperclip' AND NOT "metadata" ? 'wardmote';--> statement-breakpoint
UPDATE "company_skills"
SET "metadata" = "metadata" - 'paperclip'
WHERE "metadata" ? 'paperclip' AND "metadata" ? 'wardmote';
