DO $$
BEGIN
  UPDATE "company_skills" AS legacy
  SET
    "key" = 'tickernelz/wardmote/' || substr(legacy."key", length('paperclipai/paperclip/') + 1),
    "metadata" = CASE
      WHEN legacy."metadata" IS NULL THEN NULL
      ELSE (
        SELECT jsonb_object_agg(
          entry.key,
          CASE
            WHEN jsonb_typeof(entry.value) = 'string'
              AND entry.value #>> '{}' LIKE 'paperclipai/paperclip/%'
            THEN to_jsonb('tickernelz/wardmote/' || substr(entry.value #>> '{}', length('paperclipai/paperclip/') + 1))
            ELSE entry.value
          END
        )
        FROM jsonb_each(legacy."metadata") AS entry
      )
    END,
    "updated_at" = now()
  WHERE legacy."key" LIKE 'paperclipai/paperclip/%'
    AND NOT EXISTS (
      SELECT 1 FROM "company_skills" AS current
      WHERE current."company_id" = legacy."company_id"
        AND current."key" = 'tickernelz/wardmote/' || substr(legacy."key", length('paperclipai/paperclip/') + 1)
    );

  UPDATE "agents"
  SET "adapter_config" = jsonb_set(
    "adapter_config",
    '{paperclipSkillSync,desiredSkills}',
    (
      SELECT COALESCE(jsonb_agg(DISTINCT
        CASE
          WHEN jsonb_typeof(skill) = 'string' AND skill #>> '{}' LIKE 'paperclipai/paperclip/%'
          THEN to_jsonb('tickernelz/wardmote/' || substr(skill #>> '{}', length('paperclipai/paperclip/') + 1))
          ELSE skill
        END
      ), '[]'::jsonb)
      FROM jsonb_array_elements("adapter_config" #> '{paperclipSkillSync,desiredSkills}') AS skill
    )
  )
  WHERE jsonb_typeof("adapter_config" #> '{paperclipSkillSync,desiredSkills}') = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text("adapter_config" #> '{paperclipSkillSync,desiredSkills}') AS skill
      WHERE skill LIKE 'paperclipai/paperclip/%'
    );

  UPDATE "agent_config_revisions" AS revision
  SET
    "before_config" = CASE
      WHEN jsonb_typeof(revision."before_config" #> '{adapterConfig,paperclipSkillSync,desiredSkills}') = 'array'
        AND (revision."before_config" #> '{adapterConfig,paperclipSkillSync,desiredSkills}') @? '$[*] ? (@ like_regex "^paperclipai/paperclip/")'
      THEN jsonb_set(
        revision."before_config",
        '{adapterConfig,paperclipSkillSync,desiredSkills}',
        (
          SELECT COALESCE(jsonb_agg(DISTINCT
            CASE
              WHEN jsonb_typeof(skill) = 'string' AND skill #>> '{}' LIKE 'paperclipai/paperclip/%'
              THEN to_jsonb('tickernelz/wardmote/' || substr(skill #>> '{}', length('paperclipai/paperclip/') + 1))
              ELSE skill
            END
          ), '[]'::jsonb)
          FROM jsonb_array_elements(revision."before_config" #> '{adapterConfig,paperclipSkillSync,desiredSkills}') AS skill
        )
      )
      ELSE revision."before_config"
    END,
    "after_config" = CASE
      WHEN jsonb_typeof(revision."after_config" #> '{adapterConfig,paperclipSkillSync,desiredSkills}') = 'array'
        AND (revision."after_config" #> '{adapterConfig,paperclipSkillSync,desiredSkills}') @? '$[*] ? (@ like_regex "^paperclipai/paperclip/")'
      THEN jsonb_set(
        revision."after_config",
        '{adapterConfig,paperclipSkillSync,desiredSkills}',
        (
          SELECT COALESCE(jsonb_agg(DISTINCT
            CASE
              WHEN jsonb_typeof(skill) = 'string' AND skill #>> '{}' LIKE 'paperclipai/paperclip/%'
              THEN to_jsonb('tickernelz/wardmote/' || substr(skill #>> '{}', length('paperclipai/paperclip/') + 1))
              ELSE skill
            END
          ), '[]'::jsonb)
          FROM jsonb_array_elements(revision."after_config" #> '{adapterConfig,paperclipSkillSync,desiredSkills}') AS skill
        )
      )
      ELSE revision."after_config"
    END
  WHERE (jsonb_typeof(revision."before_config" #> '{adapterConfig,paperclipSkillSync,desiredSkills}') = 'array'
        AND (revision."before_config" #> '{adapterConfig,paperclipSkillSync,desiredSkills}') @? '$[*] ? (@ like_regex "^paperclipai/paperclip/")')
    OR (jsonb_typeof(revision."after_config" #> '{adapterConfig,paperclipSkillSync,desiredSkills}') = 'array'
        AND (revision."after_config" #> '{adapterConfig,paperclipSkillSync,desiredSkills}') @? '$[*] ? (@ like_regex "^paperclipai/paperclip/")');
END $$;
