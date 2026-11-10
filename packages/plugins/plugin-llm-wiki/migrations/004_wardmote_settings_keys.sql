UPDATE plugin_llm_wiki_8f50da974f.wiki_instances
SET settings = (
  SELECT COALESCE(jsonb_object_agg(
    regexp_replace(regexp_replace(entry.key, '^([a-z][A-Za-z0-9]*)?paperclip([A-Z0-9])', '\1wardmote\2'), '([a-z0-9])Paperclip([A-Z0-9])', '\1Wardmote\2', 'g'),
    entry.value
  ), '{}'::jsonb)
  FROM jsonb_each(plugin_llm_wiki_8f50da974f.wiki_instances.settings) AS entry
)
WHERE jsonb_typeof(settings) = 'object'
  AND EXISTS (
    SELECT 1 FROM jsonb_object_keys(plugin_llm_wiki_8f50da974f.wiki_instances.settings) AS key
    WHERE key ~ '^([a-z][A-Za-z0-9]*)?(paperclip|[a-z0-9]Paperclip)[A-Z0-9]'
  );

UPDATE plugin_llm_wiki_8f50da974f.wiki_spaces
SET settings = (
  SELECT COALESCE(jsonb_object_agg(
    regexp_replace(regexp_replace(entry.key, '^([a-z][A-Za-z0-9]*)?paperclip([A-Z0-9])', '\1wardmote\2'), '([a-z0-9])Paperclip([A-Z0-9])', '\1Wardmote\2', 'g'),
    entry.value
  ), '{}'::jsonb)
  FROM jsonb_each(plugin_llm_wiki_8f50da974f.wiki_spaces.settings) AS entry
)
WHERE jsonb_typeof(settings) = 'object'
  AND EXISTS (
    SELECT 1 FROM jsonb_object_keys(plugin_llm_wiki_8f50da974f.wiki_spaces.settings) AS key
    WHERE key ~ '^([a-z][A-Za-z0-9]*)?(paperclip|[a-z0-9]Paperclip)[A-Z0-9]'
  );
