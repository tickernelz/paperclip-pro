UPDATE "agents"
SET "adapter_config" = jsonb_set(
  "adapter_config",
  '{model}',
  to_jsonb('wardmote/' || substr("adapter_config"->>'model', length('paperclip/') + 1))
)
WHERE "adapter_config"->>'model' LIKE 'paperclip/%'
  AND (
    "adapter_type" = 'opencode_local'
    OR ("adapter_type" = 'wardmote_runner' AND "adapter_config"->>'provider' = 'opencode')
  );
