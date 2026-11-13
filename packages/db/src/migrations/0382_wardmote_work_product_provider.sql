UPDATE "issue_work_products"
SET "provider" = 'wardmote'
WHERE "provider" = 'paperclip';--> statement-breakpoint
UPDATE "smoke_run_steps"
SET "screenshot_artifact_ref" = jsonb_set("screenshot_artifact_ref", '{provider}', '"wardmote"')
WHERE "screenshot_artifact_ref"->>'provider' = 'paperclip';
