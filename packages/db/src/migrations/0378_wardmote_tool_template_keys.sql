UPDATE "tool_connections" AS c
SET "config" = jsonb_set(c."config", '{templateId}', to_jsonb(t."template_key" || '.custom')),
    "transport_config" = CASE
      WHEN c."transport_config"->>'templateId' = t."template_key"
        THEN jsonb_set(c."transport_config", '{templateId}', to_jsonb(t."template_key" || '.custom'))
      ELSE c."transport_config"
    END
FROM "tool_stdio_command_templates" AS t
WHERE t."company_id" = c."company_id"
  AND t."template_key" IN ('wardmote.echo-calculator-time', 'wardmote.synthetic-todo-kv', 'wardmote.cognee-cloud', 'wardmote.google-sheets')
  AND c."config"->>'templateId' = t."template_key";--> statement-breakpoint
UPDATE "tool_runtime_slots" AS s
SET "command_template_key" = t."template_key" || '.custom'
FROM "tool_stdio_command_templates" AS t
WHERE t."company_id" = s."company_id"
  AND t."template_key" IN ('wardmote.echo-calculator-time', 'wardmote.synthetic-todo-kv', 'wardmote.cognee-cloud', 'wardmote.google-sheets')
  AND s."command_template_key" = t."template_key";--> statement-breakpoint
UPDATE "tool_stdio_command_templates"
SET "template_key" = "template_key" || '.custom'
WHERE "template_key" IN ('wardmote.echo-calculator-time', 'wardmote.synthetic-todo-kv', 'wardmote.cognee-cloud', 'wardmote.google-sheets');--> statement-breakpoint
UPDATE "tool_connections"
SET "config" = jsonb_set("config", '{templateId}', to_jsonb('wardmote.' || substr("config"->>'templateId', length('paperclip.') + 1)))
WHERE "config"->>'templateId' IN ('paperclip.echo-calculator-time', 'paperclip.synthetic-todo-kv', 'paperclip.cognee-cloud', 'paperclip.google-sheets', 'paperclip.local-stdio-fixture', 'paperclip.slow-stateful-stdio');--> statement-breakpoint
UPDATE "tool_connections"
SET "transport_config" = jsonb_set("transport_config", '{templateId}', to_jsonb('wardmote.' || substr("transport_config"->>'templateId', length('paperclip.') + 1)))
WHERE "transport_config"->>'templateId' IN ('paperclip.echo-calculator-time', 'paperclip.synthetic-todo-kv', 'paperclip.cognee-cloud', 'paperclip.google-sheets', 'paperclip.local-stdio-fixture', 'paperclip.slow-stateful-stdio');--> statement-breakpoint
UPDATE "tool_runtime_slots"
SET "command_template_key" = 'wardmote.' || substr("command_template_key", length('paperclip.') + 1)
WHERE "command_template_key" IN ('paperclip.echo-calculator-time', 'paperclip.synthetic-todo-kv', 'paperclip.cognee-cloud', 'paperclip.google-sheets', 'paperclip.local-stdio-fixture', 'paperclip.slow-stateful-stdio');--> statement-breakpoint
UPDATE "tool_runtime_slots"
SET "provider_ref" = 'template:wardmote.' || substr("provider_ref", length('template:paperclip.') + 1)
WHERE "provider_ref" LIKE 'template:paperclip.%';--> statement-breakpoint
UPDATE "tool_runtime_slots"
SET "metadata" = jsonb_set("metadata", '{templateId}', to_jsonb('wardmote.' || substr("metadata"->>'templateId', length('paperclip.') + 1)))
WHERE "metadata"->>'templateId' LIKE 'paperclip.%';--> statement-breakpoint
UPDATE "tool_runtime_slots"
SET "provider" = 'wardmote'
WHERE "provider" = 'paperclip';--> statement-breakpoint
UPDATE "tool_connections"
SET "uid" = 'wardmote/' || substr("uid", length('paperclip/') + 1)
WHERE "uid" LIKE 'paperclip/%'
  AND "application_id" IN (
    SELECT "id" FROM "tool_applications" WHERE "application_key" = 'paperclip.examples.safe-read-only-todo-kv'
  );--> statement-breakpoint
UPDATE "tool_applications"
SET "application_key" = 'wardmote.examples.safe-read-only-todo-kv'
WHERE "application_key" = 'paperclip.examples.safe-read-only-todo-kv';--> statement-breakpoint
UPDATE "tool_profiles"
SET "profile_key" = 'wardmote.examples.safe-read-only-todo-kv.profile'
WHERE "profile_key" = 'paperclip.examples.safe-read-only-todo-kv.profile';--> statement-breakpoint
UPDATE "tool_applications"
SET "metadata" = jsonb_set("metadata", '{source}', '"wardmote_example"')
WHERE "metadata"->>'source' = 'paperclip_example';--> statement-breakpoint
UPDATE "tool_profiles"
SET "metadata" = jsonb_set("metadata", '{source}', '"wardmote_example"')
WHERE "metadata"->>'source' = 'paperclip_example';--> statement-breakpoint
UPDATE "tool_profile_bindings"
SET "metadata" = jsonb_set("metadata", '{source}', '"wardmote_example"')
WHERE "metadata"->>'source' = 'paperclip_example';--> statement-breakpoint
UPDATE "tool_profile_entries"
SET "conditions" = jsonb_set("conditions", '{source}', '"wardmote_example"')
WHERE "conditions"->>'source' = 'paperclip_example';--> statement-breakpoint
UPDATE "tool_connections"
SET "config" = jsonb_set("config", '{connectionType}', '"pages"')
WHERE "application_id" IN (
    SELECT "id" FROM "tool_applications" WHERE "application_key" IN ('paperclip.pages', 'pages.paperclip')
  )
  AND "config"->>'connectionType' IS NULL;--> statement-breakpoint
UPDATE "tool_applications" AS a
SET "application_key" = 'wardmote-pages'
WHERE a."application_key" = 'paperclip.pages'
  AND NOT EXISTS (
    SELECT 1 FROM "tool_applications" AS b
    WHERE b."company_id" = a."company_id" AND b."application_key" = 'wardmote-pages'
  );--> statement-breakpoint
UPDATE "tool_applications" AS a
SET "application_key" = 'wardmote-pages'
WHERE a."application_key" = 'pages.paperclip'
  AND NOT EXISTS (
    SELECT 1 FROM "tool_applications" AS b
    WHERE b."company_id" = a."company_id" AND b."application_key" = 'wardmote-pages'
  );
