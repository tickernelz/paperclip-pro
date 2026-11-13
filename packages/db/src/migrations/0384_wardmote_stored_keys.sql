UPDATE "issues"
SET "origin_id" = 'wardmote-runner:' || substr("origin_id", length('paperclip-runner:') + 1)
WHERE "origin_id" LIKE 'paperclip-runner:create-task:%';--> statement-breakpoint
UPDATE "tool_applications"
SET "application_key" = 'wardmote.' || substr("application_key", length('paperclip.') + 1)
WHERE "application_key" IN ('paperclip.smoke-lab.http-fixture', 'paperclip.smoke-lab.stdio-fixture');--> statement-breakpoint
UPDATE "tool_stdio_command_templates"
SET "template_key" = 'wardmote.smoke-lab.stdio-fixture'
WHERE "template_key" = 'paperclip.smoke-lab.stdio-fixture';--> statement-breakpoint
UPDATE "tool_profiles"
SET "profile_key" = 'wardmote.smoke-lab.profile'
WHERE "profile_key" = 'paperclip.smoke-lab.profile';--> statement-breakpoint
UPDATE "tool_connections"
SET "config" = jsonb_set("config", '{templateId}', '"wardmote.smoke-lab.stdio-fixture"')
WHERE "config"->>'templateId' = 'paperclip.smoke-lab.stdio-fixture';--> statement-breakpoint
UPDATE "tool_connections"
SET "transport_config" = jsonb_set("transport_config", '{templateId}', '"wardmote.smoke-lab.stdio-fixture"')
WHERE "transport_config"->>'templateId' = 'paperclip.smoke-lab.stdio-fixture';--> statement-breakpoint
UPDATE "tool_runtime_slots"
SET "command_template_key" = 'wardmote.smoke-lab.stdio-fixture'
WHERE "command_template_key" = 'paperclip.smoke-lab.stdio-fixture';
