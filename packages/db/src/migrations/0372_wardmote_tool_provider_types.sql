UPDATE "tool_applications"
SET "type" = 'wardmote_plugin'
WHERE "type" = 'paperclip_plugin';--> statement-breakpoint
UPDATE "tool_applications" a
SET "application_key" = 'wardmote_plugin:' || substr(a."application_key", 18)
WHERE a."application_key" LIKE 'paperclip\_plugin:%'
  AND NOT EXISTS (
    SELECT 1 FROM "tool_applications" b
    WHERE b."company_id" = a."company_id"
      AND b."application_key" = 'wardmote_plugin:' || substr(a."application_key", 18)
  );--> statement-breakpoint
UPDATE "tool_connections"
SET "config" = jsonb_set("config", '{type}', '"wardmote_plugin"')
WHERE "config" ->> 'type' = 'paperclip_plugin';--> statement-breakpoint
UPDATE "tool_connections"
SET "transport_config" = jsonb_set("transport_config", '{type}', '"wardmote_plugin"')
WHERE "transport_config" ->> 'type' = 'paperclip_plugin';--> statement-breakpoint
UPDATE "tool_invocations"
SET "provider_type" = 'wardmote_' || substr("provider_type", 11)
WHERE "provider_type" IN ('paperclip_self', 'paperclip_virtual', 'paperclip_plugin', 'paperclip_github_chat', 'paperclip_slack_chat', 'paperclip_speko_voice');--> statement-breakpoint
UPDATE "tool_invocations"
SET "application_key" = 'wardmote_plugin:' || substr("application_key", 18)
WHERE "application_key" LIKE 'paperclip\_plugin:%';
