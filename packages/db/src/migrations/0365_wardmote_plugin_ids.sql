DO $$
DECLARE
  namespace_row record;
BEGIN
  CREATE TEMP TABLE wardmote_plugin_key_map (old_key text PRIMARY KEY, new_key text NOT NULL) ON COMMIT DROP;
  INSERT INTO wardmote_plugin_key_map (old_key, new_key) VALUES
    ('paperclipai.plugin-llm-wiki', 'wardmote.plugin-llm-wiki'),
    ('paperclipai.plugin-briefs', 'wardmote.plugin-briefs'),
    ('paperclipai.content-machine', 'wardmote.content-machine'),
    ('paperclipai.plugin-orchestration-smoke-example', 'wardmote.plugin-orchestration-smoke-example'),
    ('paperclipai.plugin-authoring-smoke-example', 'wardmote.plugin-authoring-smoke-example'),
    ('paperclip.createos-sandbox-provider', 'wardmote.createos-sandbox-provider'),
    ('paperclip.cloudflare-sandbox-provider', 'wardmote.cloudflare-sandbox-provider'),
    ('paperclip.daytona-sandbox-provider', 'wardmote.daytona-sandbox-provider'),
    ('paperclip.e2b-sandbox-provider', 'wardmote.e2b-sandbox-provider'),
    ('paperclip.exe-dev-sandbox-provider', 'wardmote.exe-dev-sandbox-provider'),
    ('paperclip.kubernetes-sandbox-provider', 'wardmote.kubernetes-sandbox-provider'),
    ('paperclip.modal-sandbox-provider', 'wardmote.modal-sandbox-provider'),
    ('paperclip.novita-sandbox-provider', 'wardmote.novita-sandbox-provider'),
    ('paperclip.fake-sandbox-provider', 'wardmote.fake-sandbox-provider'),
    ('paperclip.workspace-diff', 'wardmote.workspace-diff'),
    ('paperclip.hello-world-example', 'wardmote.hello-world-example'),
    ('paperclip-file-browser-example', 'wardmote-file-browser-example'),
    ('paperclip-kitchen-sink-example', 'wardmote-kitchen-sink-example');

  DELETE FROM wardmote_plugin_key_map AS map
  WHERE EXISTS (SELECT 1 FROM "plugins" WHERE "plugin_key" = map.new_key);

  CREATE TEMP TABLE wardmote_plugin_namespace_map (old_name text PRIMARY KEY, new_name text NOT NULL) ON COMMIT DROP;
  INSERT INTO wardmote_plugin_namespace_map (old_name, new_name) VALUES
    ('plugin_llm_wiki_8f50da974f', 'plugin_llm_wiki_1e554e7667'),
    ('plugin_orchestration_smoke_1e8c264c64', 'plugin_orchestration_smoke_bb8146106b');

  CREATE TEMP TABLE wardmote_plugin_checksum_map (old_checksum text PRIMARY KEY, new_checksum text NOT NULL) ON COMMIT DROP;
  INSERT INTO wardmote_plugin_checksum_map (old_checksum, new_checksum) VALUES
    ('fc392bf90771b716053de451810ea196c7aa8ab44478fcd18803928384da41d3', '106b2c36f71a3f0faa31a6a53e8455a3f5b9e1fac13b72c497fea4cb432c714a'),
    ('57162e4aaf5f64c428acb2c9d8b0fa47e6f27c3cc3fa1350d99e3dd1b2db77e5', '5c3acabd8ebfcc9c6a5995e2c594abd922c265b1fb6c8db1b1b4535b3d97be13'),
    ('82056a08864d022742b3900ff1799df553beea90c4fdc3816f3b23776b72a366', '96e89feec7363d857aef2bb95a270a21cd0a1b292c89967c20c676c042f723e1'),
    ('01d936d8a121c56371a318c0a5b84e13431c0f9de9705cf0389666b06778cb92', '5f6cf43a9c4036531812c9a68ac305e4318e29ec3c60ac16902bb32c4208f4ca'),
    ('b2768a65b30e7906e00e90d8f50044e4be7185d11eb07e825ae2792c2f19e26a', '07fa8f83fe733f63fa517c631b553015b6a829836e648e9f731335a5ecec493a');

  FOR namespace_row IN
    SELECT ns."id", ns."namespace_name" AS old_name, nm.new_name
    FROM "plugin_database_namespaces" AS ns
    JOIN wardmote_plugin_key_map AS map ON map.old_key = ns."plugin_key"
    JOIN wardmote_plugin_namespace_map AS nm ON nm.old_name = ns."namespace_name"
    WHERE NOT EXISTS (SELECT 1 FROM "plugin_database_namespaces" WHERE "namespace_name" = nm.new_name)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = namespace_row.old_name)
      AND NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = namespace_row.new_name)
    THEN
      EXECUTE format('ALTER SCHEMA %I RENAME TO %I', namespace_row.old_name, namespace_row.new_name);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = namespace_row.old_name) THEN
      UPDATE "plugin_database_namespaces"
      SET "namespace_name" = namespace_row.new_name, "updated_at" = now()
      WHERE "id" = namespace_row."id";
      UPDATE "plugin_migrations"
      SET "namespace_name" = namespace_row.new_name
      WHERE "namespace_name" = namespace_row.old_name;
    END IF;
  END LOOP;

  UPDATE "plugin_migrations" AS migration
  SET "checksum" = cm.new_checksum
  FROM wardmote_plugin_key_map AS map, wardmote_plugin_checksum_map AS cm
  WHERE migration."plugin_key" = map.old_key
    AND migration."checksum" = cm.old_checksum
    AND migration."namespace_name" IN (SELECT new_name FROM wardmote_plugin_namespace_map);

  UPDATE "plugin_migrations" AS migration SET "plugin_key" = map.new_key
  FROM wardmote_plugin_key_map AS map WHERE migration."plugin_key" = map.old_key;
  UPDATE "plugin_database_namespaces" AS ns SET "plugin_key" = map.new_key, "updated_at" = now()
  FROM wardmote_plugin_key_map AS map WHERE ns."plugin_key" = map.old_key;
  UPDATE "plugin_managed_resources" AS resource SET "plugin_key" = map.new_key, "updated_at" = now()
  FROM wardmote_plugin_key_map AS map WHERE resource."plugin_key" = map.old_key;
  UPDATE "ai_connection_pools" AS pool SET "plugin_key" = map.new_key
  FROM wardmote_plugin_key_map AS map WHERE pool."plugin_key" = map.old_key;
  UPDATE "plugins" AS plugin
  SET
    "plugin_key" = map.new_key,
    "manifest_json" = CASE
      WHEN plugin."manifest_json" ->> 'id' = map.old_key THEN jsonb_set(plugin."manifest_json", '{id}', to_jsonb(map.new_key))
      ELSE plugin."manifest_json"
    END,
    "updated_at" = now()
  FROM wardmote_plugin_key_map AS map
  WHERE plugin."plugin_key" = map.old_key;

  UPDATE "issues" AS issue
  SET "origin_kind" = 'plugin:' || map.new_key || substr(issue."origin_kind", length('plugin:' || map.old_key) + 1)
  FROM wardmote_plugin_key_map AS map
  WHERE issue."origin_kind" = 'plugin:' || map.old_key
    OR issue."origin_kind" LIKE 'plugin:' || map.old_key || ':%';

  UPDATE "agent_task_sessions" AS session
  SET "task_key" = 'plugin:' || map.new_key || substr(session."task_key", length('plugin:' || map.old_key) + 1)
  FROM wardmote_plugin_key_map AS map
  WHERE session."task_key" LIKE 'plugin:' || map.old_key || ':%';

  UPDATE "environment_leases" AS lease
  SET "provider" = 'plugin:' || map.new_key || substr(lease."provider", length('plugin:' || map.old_key) + 1)
  FROM wardmote_plugin_key_map AS map
  WHERE lease."provider" LIKE 'plugin:' || map.old_key || ':%';
  UPDATE "environment_custom_image_templates" AS template
  SET "provider" = 'plugin:' || map.new_key || substr(template."provider", length('plugin:' || map.old_key) + 1)
  FROM wardmote_plugin_key_map AS map
  WHERE template."provider" LIKE 'plugin:' || map.old_key || ':%';
  UPDATE "environment_custom_image_setup_sessions" AS setup
  SET "provider" = 'plugin:' || map.new_key || substr(setup."provider", length('plugin:' || map.old_key) + 1)
  FROM wardmote_plugin_key_map AS map
  WHERE setup."provider" LIKE 'plugin:' || map.old_key || ':%';

  UPDATE "environments" AS environment
  SET "config" = jsonb_set(environment."config", '{pluginKey}', to_jsonb(map.new_key))
  FROM wardmote_plugin_key_map AS map
  WHERE environment."config" ->> 'pluginKey' = map.old_key;
END $$;
