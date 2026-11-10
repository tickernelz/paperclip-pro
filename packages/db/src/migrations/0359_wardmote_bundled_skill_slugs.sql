CREATE OR REPLACE FUNCTION pg_temp.wardmote_skill_ref(ref text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN ref ~ '^(tickernelz/wardmote/)?paperclip(-board|-converting-plans-to-tasks|-create-agent)?$'
    THEN regexp_replace(ref, 'paperclip((-board|-converting-plans-to-tasks|-create-agent)?)$', 'wardmote\1')
    ELSE ref
  END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.wardmote_skill_sync(sync jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN jsonb_typeof(sync -> 'desiredSkills') = 'array' THEN jsonb_set(
      sync,
      '{desiredSkills}',
      (
        SELECT COALESCE(jsonb_agg(
          CASE WHEN jsonb_typeof(skill) = 'string' THEN to_jsonb(pg_temp.wardmote_skill_ref(skill #>> '{}')) ELSE skill END
          ORDER BY position
        ), '[]'::jsonb)
        FROM jsonb_array_elements(sync -> 'desiredSkills') WITH ORDINALITY AS entry(skill, position)
      )
    )
    ELSE sync
  END
$fn$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.wardmote_adapter_config(config jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN jsonb_typeof(config) = 'object' AND config ? 'paperclipSkillSync' AND NOT config ? 'wardmoteSkillSync'
    THEN (config - 'paperclipSkillSync') || jsonb_build_object('wardmoteSkillSync', pg_temp.wardmote_skill_sync(config -> 'paperclipSkillSync'))
    WHEN jsonb_typeof(config) = 'object' AND config ? 'wardmoteSkillSync'
    THEN jsonb_set(config, '{wardmoteSkillSync}', pg_temp.wardmote_skill_sync(config -> 'wardmoteSkillSync'))
    ELSE config
  END
$fn$;
--> statement-breakpoint
UPDATE "company_skills" AS legacy
SET
  "key" = pg_temp.wardmote_skill_ref(legacy."key"),
  "slug" = pg_temp.wardmote_skill_ref(legacy."slug"),
  "name" = pg_temp.wardmote_skill_ref(legacy."name"),
  "source_locator" = regexp_replace(
    legacy."source_locator",
    '/skills/paperclip((-board|-converting-plans-to-tasks|-create-agent)?)$',
    '/skills/wardmote\1'
  ),
  "updated_at" = now()
WHERE legacy."key" ~ '^tickernelz/wardmote/paperclip(-board|-converting-plans-to-tasks|-create-agent)?$'
  AND NOT EXISTS (
    SELECT 1 FROM "company_skills" AS current
    WHERE current."company_id" = legacy."company_id"
      AND current."key" = pg_temp.wardmote_skill_ref(legacy."key")
  );
--> statement-breakpoint
UPDATE "company_skills"
SET
  "metadata" = "metadata"
    || CASE
      WHEN jsonb_typeof("metadata" -> 'skillKey') = 'string'
      THEN jsonb_build_object('skillKey', pg_temp.wardmote_skill_ref("metadata" ->> 'skillKey'))
      ELSE '{}'::jsonb
    END
    || CASE
      WHEN "metadata" ->> 'sourceKind' = 'paperclip_bundled'
      THEN jsonb_build_object('sourceKind', 'wardmote_bundled')
      ELSE '{}'::jsonb
    END,
  "updated_at" = now()
WHERE jsonb_typeof("metadata") = 'object'
  AND (
    "metadata" ->> 'sourceKind' = 'paperclip_bundled'
    OR "metadata" ->> 'skillKey' ~ '^tickernelz/wardmote/paperclip(-board|-converting-plans-to-tasks|-create-agent)?$'
  );
--> statement-breakpoint
UPDATE "agents"
SET "adapter_config" = pg_temp.wardmote_adapter_config("adapter_config")
WHERE "adapter_config" IS DISTINCT FROM pg_temp.wardmote_adapter_config("adapter_config");
--> statement-breakpoint
UPDATE "agent_config_revisions"
SET
  "before_config" = CASE
    WHEN jsonb_typeof("before_config" -> 'adapterConfig') = 'object'
    THEN jsonb_set("before_config", '{adapterConfig}', pg_temp.wardmote_adapter_config("before_config" -> 'adapterConfig'))
    ELSE "before_config"
  END,
  "after_config" = CASE
    WHEN jsonb_typeof("after_config" -> 'adapterConfig') = 'object'
    THEN jsonb_set("after_config", '{adapterConfig}', pg_temp.wardmote_adapter_config("after_config" -> 'adapterConfig'))
    ELSE "after_config"
  END
WHERE pg_temp.wardmote_adapter_config("before_config" -> 'adapterConfig') IS DISTINCT FROM ("before_config" -> 'adapterConfig')
  OR pg_temp.wardmote_adapter_config("after_config" -> 'adapterConfig') IS DISTINCT FROM ("after_config" -> 'adapterConfig');
--> statement-breakpoint
DROP FUNCTION pg_temp.wardmote_adapter_config(jsonb);
--> statement-breakpoint
DROP FUNCTION pg_temp.wardmote_skill_sync(jsonb);
--> statement-breakpoint
DROP FUNCTION pg_temp.wardmote_skill_ref(text);
