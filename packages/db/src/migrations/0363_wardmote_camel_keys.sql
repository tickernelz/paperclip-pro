CREATE OR REPLACE FUNCTION "wardmote_rename_retired_keys"(value jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE jsonb_typeof(value)
    WHEN 'object' THEN (
      SELECT COALESCE(jsonb_object_agg(
        regexp_replace(regexp_replace(entry.key, '^([a-z][A-Za-z0-9]*)?paperclip([A-Z0-9])', '\1wardmote\2'), '([a-z0-9])Paperclip([A-Z0-9])', '\1Wardmote\2', 'g'),
        "wardmote_rename_retired_keys"(entry.value)
      ), '{}'::jsonb)
      FROM jsonb_each(value) AS entry
    )
    WHEN 'array' THEN (
      SELECT COALESCE(jsonb_agg("wardmote_rename_retired_keys"(element.value) ORDER BY element.ordinality), '[]'::jsonb)
      FROM jsonb_array_elements(value) WITH ORDINALITY AS element(value, ordinality)
    )
    ELSE value
  END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "wardmote_has_retired_keys"(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT value IS NOT NULL AND value::text ~ '"([a-z][A-Za-z0-9]*)?(paperclip|[a-z0-9]Paperclip)[A-Z0-9][A-Za-z0-9]*":'
$$;--> statement-breakpoint
UPDATE "instance_settings" SET
  "general" = "wardmote_rename_retired_keys"("general"),
  "experimental" = "wardmote_rename_retired_keys"("experimental")
WHERE "wardmote_has_retired_keys"("general") OR "wardmote_has_retired_keys"("experimental");--> statement-breakpoint
UPDATE "agents" SET
  "adapter_config" = "wardmote_rename_retired_keys"("adapter_config"),
  "runtime_config" = "wardmote_rename_retired_keys"("runtime_config"),
  "metadata" = "wardmote_rename_retired_keys"("metadata")
WHERE "wardmote_has_retired_keys"("adapter_config") OR "wardmote_has_retired_keys"("runtime_config") OR "wardmote_has_retired_keys"("metadata");--> statement-breakpoint
UPDATE "agent_config_revisions" SET
  "before_config" = "wardmote_rename_retired_keys"("before_config"),
  "after_config" = "wardmote_rename_retired_keys"("after_config")
WHERE "wardmote_has_retired_keys"("before_config") OR "wardmote_has_retired_keys"("after_config");--> statement-breakpoint
UPDATE "agent_task_sessions" SET "session_params_json" = "wardmote_rename_retired_keys"("session_params_json")
WHERE "wardmote_has_retired_keys"("session_params_json");--> statement-breakpoint
UPDATE "agent_wakeup_requests" SET "payload" = "wardmote_rename_retired_keys"("payload")
WHERE "status" NOT IN ('completed', 'cancelled', 'failed', 'skipped', 'coalesced', 'interrupted') AND "wardmote_has_retired_keys"("payload");--> statement-breakpoint
UPDATE "plugin_config" SET "config_json" = "wardmote_rename_retired_keys"("config_json")
WHERE "wardmote_has_retired_keys"("config_json");--> statement-breakpoint
UPDATE "plugin_company_settings" SET "settings_json" = "wardmote_rename_retired_keys"("settings_json")
WHERE "wardmote_has_retired_keys"("settings_json");--> statement-breakpoint
UPDATE "heartbeat_runs" SET "context_snapshot" = (
  SELECT COALESCE(jsonb_object_agg(
    regexp_replace(entry.key, '^paperclip([A-Z0-9])', 'wardmote\1'), entry.value
  ), '{}'::jsonb)
  FROM jsonb_each("heartbeat_runs"."context_snapshot") AS entry
)
WHERE jsonb_typeof("context_snapshot") = 'object'
  AND ("status" IN ('queued', 'running') OR "created_at" > now() - interval '14 days' OR "context_snapshot" ? 'paperclipSecretRedactions')
  AND EXISTS (SELECT 1 FROM jsonb_object_keys("heartbeat_runs"."context_snapshot") AS key WHERE key ~ '^paperclip[A-Z0-9]');--> statement-breakpoint
DROP FUNCTION "wardmote_has_retired_keys"(jsonb);--> statement-breakpoint
DROP FUNCTION "wardmote_rename_retired_keys"(jsonb);--> statement-breakpoint
DROP INDEX IF EXISTS "agents_company_built_in_agent_key_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "agents_company_built_in_agent_key_unique_idx"
  ON "agents" ("company_id", (("metadata" -> 'wardmoteBuiltInAgent' ->> 'key')))
  WHERE ("metadata" -> 'wardmoteBuiltInAgent' ->> 'key') IS NOT NULL AND "status" <> 'terminated';--> statement-breakpoint
DROP INDEX IF EXISTS "heartbeat_runs_company_ctx_issue_redaction_idx";--> statement-breakpoint
CREATE INDEX "heartbeat_runs_company_ctx_issue_redaction_idx" ON "heartbeat_runs" USING btree ("company_id",("context_snapshot" ->> 'issueId')) WHERE "heartbeat_runs"."context_snapshot" ? 'wardmoteSecretRedactions';
