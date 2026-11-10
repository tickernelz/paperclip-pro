DO $$
BEGIN
  UPDATE "folders" AS legacy
  SET
    "system_key" = 'bundled:wardmote-core',
    "slug" = CASE WHEN legacy."slug" = 'paperclip-core' THEN 'wardmote-core' ELSE legacy."slug" END,
    "name" = CASE WHEN legacy."name" = 'Paperclip Core' THEN 'Wardmote Core' ELSE legacy."name" END,
    "updated_at" = now()
  WHERE legacy."system_key" = 'bundled:paperclip-core'
    AND NOT EXISTS (
      SELECT 1 FROM "folders" AS current
      WHERE current."company_id" = legacy."company_id"
        AND current."kind" = legacy."kind"
        AND current."system_key" = 'bundled:wardmote-core'
    )
    AND NOT EXISTS (
      SELECT 1 FROM "folders" AS sibling
      WHERE sibling."company_id" = legacy."company_id"
        AND sibling."kind" = legacy."kind"
        AND sibling."parent_id" IS NOT DISTINCT FROM legacy."parent_id"
        AND sibling."slug" = 'wardmote-core'
    );

  UPDATE "company_skills" AS legacy
  SET
    "key" = CASE
      WHEN legacy."key" ~ '^paperclipai/(bundled|optional)/'
        AND NOT EXISTS (
          SELECT 1 FROM "company_skills" AS current
          WHERE current."company_id" = legacy."company_id"
            AND current."key" = regexp_replace(
              regexp_replace(legacy."key", '^paperclipai/', 'tickernelz/'),
              '/paperclip-(operations|capsules)/', '/wardmote-\1/'
            )
        )
      THEN regexp_replace(
        regexp_replace(legacy."key", '^paperclipai/', 'tickernelz/'),
        '/paperclip-(operations|capsules)/', '/wardmote-\1/'
      )
      ELSE legacy."key"
    END,
    "metadata" = CASE
      WHEN legacy."metadata"::text ~ '"paperclipai[/:](bundled|optional)[/:]|paperclip-(operations|capsules)'
      THEN regexp_replace(
        regexp_replace(legacy."metadata"::text, '"paperclipai([/:])(bundled|optional)\1', '"tickernelz\1\2\1', 'g'),
        '([/:"])paperclip-(operations|capsules)([/:"])', '\1wardmote-\2\3', 'g'
      )::jsonb
      ELSE legacy."metadata"
    END,
    "updated_at" = now()
  WHERE (
      legacy."key" ~ '^paperclipai/(bundled|optional)/'
      AND NOT EXISTS (
        SELECT 1 FROM "company_skills" AS current
        WHERE current."company_id" = legacy."company_id"
          AND current."key" = regexp_replace(
            regexp_replace(legacy."key", '^paperclipai/', 'tickernelz/'),
            '/paperclip-(operations|capsules)/', '/wardmote-\1/'
          )
      )
    )
    OR legacy."metadata"::text ~ '"paperclipai[/:](bundled|optional)[/:]|paperclip-(operations|capsules)';

  UPDATE "agents"
  SET
    "adapter_config" = regexp_replace(
      regexp_replace("adapter_config"::text, '"paperclipai([/:])(bundled|optional)\1', '"tickernelz\1\2\1', 'g'),
      '([/:"])paperclip-(operations|capsules)([/:"])', '\1wardmote-\2\3', 'g'
    )::jsonb,
    "metadata" = CASE
      WHEN "metadata" IS NULL THEN NULL
      ELSE regexp_replace(
        regexp_replace("metadata"::text, '"paperclipai([/:])(bundled|optional)\1', '"tickernelz\1\2\1', 'g'),
        '([/:"])paperclip-(operations|capsules)([/:"])', '\1wardmote-\2\3', 'g'
      )::jsonb
    END
  WHERE "adapter_config"::text ~ '"paperclipai[/:](bundled|optional)[/:]|[/:"]paperclip-(operations|capsules)[/:"]'
    OR "metadata"::text ~ '"paperclipai[/:](bundled|optional)[/:]|[/:"]paperclip-(operations|capsules)[/:"]';

  UPDATE "agent_config_revisions"
  SET
    "before_config" = regexp_replace(
      regexp_replace("before_config"::text, '"paperclipai([/:])(bundled|optional)\1', '"tickernelz\1\2\1', 'g'),
      '([/:"])paperclip-(operations|capsules)([/:"])', '\1wardmote-\2\3', 'g'
    )::jsonb,
    "after_config" = regexp_replace(
      regexp_replace("after_config"::text, '"paperclipai([/:])(bundled|optional)\1', '"tickernelz\1\2\1', 'g'),
      '([/:"])paperclip-(operations|capsules)([/:"])', '\1wardmote-\2\3', 'g'
    )::jsonb
  WHERE "before_config"::text ~ '"paperclipai[/:](bundled|optional)[/:]|[/:"]paperclip-(operations|capsules)[/:"]'
    OR "after_config"::text ~ '"paperclipai[/:](bundled|optional)[/:]|[/:"]paperclip-(operations|capsules)[/:"]';
END $$;
