DO $$
DECLARE
  prefix record;
BEGIN
  CREATE TEMP TABLE wardmote_skill_prefix_map (old_prefix text PRIMARY KEY, new_prefix text NOT NULL) ON COMMIT DROP;
  INSERT INTO wardmote_skill_prefix_map (old_prefix, new_prefix) VALUES
    ('plugin/paperclipai-plugin-llm-wiki/', 'plugin/wardmote-plugin-llm-wiki/'),
    ('plugin/paperclipai-plugin-briefs/', 'plugin/wardmote-plugin-briefs/'),
    ('plugin/paperclipai-content-machine/', 'plugin/wardmote-content-machine/'),
    ('plugin/paperclipai-plugin-orchestration-smoke-example/', 'plugin/wardmote-plugin-orchestration-smoke-example/'),
    ('plugin/paperclipai-plugin-authoring-smoke-example/', 'plugin/wardmote-plugin-authoring-smoke-example/'),
    ('plugin/paperclip-createos-sandbox-provider/', 'plugin/wardmote-createos-sandbox-provider/'),
    ('plugin/paperclip-cloudflare-sandbox-provider/', 'plugin/wardmote-cloudflare-sandbox-provider/'),
    ('plugin/paperclip-daytona-sandbox-provider/', 'plugin/wardmote-daytona-sandbox-provider/'),
    ('plugin/paperclip-e2b-sandbox-provider/', 'plugin/wardmote-e2b-sandbox-provider/'),
    ('plugin/paperclip-exe-dev-sandbox-provider/', 'plugin/wardmote-exe-dev-sandbox-provider/'),
    ('plugin/paperclip-kubernetes-sandbox-provider/', 'plugin/wardmote-kubernetes-sandbox-provider/'),
    ('plugin/paperclip-modal-sandbox-provider/', 'plugin/wardmote-modal-sandbox-provider/'),
    ('plugin/paperclip-novita-sandbox-provider/', 'plugin/wardmote-novita-sandbox-provider/'),
    ('plugin/paperclip-fake-sandbox-provider/', 'plugin/wardmote-fake-sandbox-provider/'),
    ('plugin/paperclip-workspace-diff/', 'plugin/wardmote-workspace-diff/'),
    ('plugin/paperclip-hello-world-example/', 'plugin/wardmote-hello-world-example/'),
    ('plugin/paperclip-file-browser-example/', 'plugin/wardmote-file-browser-example/'),
    ('plugin/paperclip-kitchen-sink-example/', 'plugin/wardmote-kitchen-sink-example/');

  FOR prefix IN SELECT old_prefix, new_prefix FROM wardmote_skill_prefix_map LOOP
    UPDATE "company_skills" AS skill
    SET "key" = prefix.new_prefix || substr(skill."key", length(prefix.old_prefix) + 1),
        "markdown" = replace(skill."markdown", '"' || prefix.old_prefix, '"' || prefix.new_prefix),
        "updated_at" = now()
    WHERE skill."key" LIKE prefix.old_prefix || '%'
      AND NOT EXISTS (
        SELECT 1 FROM "company_skills" AS taken
        WHERE taken."company_id" = skill."company_id"
          AND taken."key" = prefix.new_prefix || substr(skill."key", length(prefix.old_prefix) + 1)
      );
    UPDATE "agents"
    SET "adapter_config" = replace("adapter_config"::text, '"' || prefix.old_prefix, '"' || prefix.new_prefix)::jsonb
    WHERE "adapter_config"::text LIKE '%"' || prefix.old_prefix || '%';
    UPDATE "company_skill_policies"
    SET "rules" = replace("rules"::text, '"' || prefix.old_prefix, '"' || prefix.new_prefix)::jsonb
    WHERE "rules"::text LIKE '%"' || prefix.old_prefix || '%';
    UPDATE "plugin_managed_resources"
    SET "defaults_json" = replace("defaults_json"::text, '"' || prefix.old_prefix, '"' || prefix.new_prefix)::jsonb
    WHERE "resource_kind" = 'skill'
      AND "defaults_json"::text LIKE '%"' || prefix.old_prefix || '%';
  END LOOP;

  UPDATE "company_skills" AS skill
  SET "key" = 'plugin/wardmote-plugin-llm-wiki/wardmote-distill',
      "slug" = CASE WHEN skill."slug" = 'paperclip-distill' THEN 'wardmote-distill' ELSE skill."slug" END,
      "markdown" = replace(skill."markdown", '"plugin/wardmote-plugin-llm-wiki/paperclip-distill"', '"plugin/wardmote-plugin-llm-wiki/wardmote-distill"'),
      "updated_at" = now()
  WHERE skill."key" = 'plugin/wardmote-plugin-llm-wiki/paperclip-distill'
    AND NOT EXISTS (
      SELECT 1 FROM "company_skills" AS taken
      WHERE taken."company_id" = skill."company_id"
        AND taken."key" = 'plugin/wardmote-plugin-llm-wiki/wardmote-distill'
    );
  UPDATE "agents"
  SET "adapter_config" = replace("adapter_config"::text, '"plugin/wardmote-plugin-llm-wiki/paperclip-distill"', '"plugin/wardmote-plugin-llm-wiki/wardmote-distill"')::jsonb
  WHERE "adapter_config"::text LIKE '%"plugin/wardmote-plugin-llm-wiki/paperclip-distill"%';
  UPDATE "company_skill_policies"
  SET "rules" = replace("rules"::text, '"plugin/wardmote-plugin-llm-wiki/paperclip-distill"', '"plugin/wardmote-plugin-llm-wiki/wardmote-distill"')::jsonb
  WHERE "rules"::text LIKE '%"plugin/wardmote-plugin-llm-wiki/paperclip-distill"%';
  UPDATE "plugin_managed_resources"
  SET "resource_key" = 'wardmote-distill',
      "defaults_json" = replace(replace("defaults_json"::text, '"plugin/wardmote-plugin-llm-wiki/paperclip-distill"', '"plugin/wardmote-plugin-llm-wiki/wardmote-distill"'), '"paperclip-distill"', '"wardmote-distill"')::jsonb,
      "updated_at" = now()
  WHERE "plugin_key" = 'wardmote.plugin-llm-wiki'
    AND "resource_kind" = 'skill'
    AND "resource_key" = 'paperclip-distill';
END $$;
