UPDATE "mcp_oauth_grants"
SET "scopes" = (
  SELECT jsonb_agg(CASE WHEN value IN ('"paperclip:read"', '"paperclip:write"', '"paperclip:configure"', '"paperclip:agent"') THEN to_jsonb('wardmote:' || substr(value #>> '{}', 11)) ELSE value END ORDER BY ordinality)
  FROM jsonb_array_elements("scopes") WITH ORDINALITY
)
WHERE jsonb_typeof("scopes") = 'array'
  AND "scopes" ?| ARRAY['paperclip:read', 'paperclip:write', 'paperclip:configure', 'paperclip:agent'];--> statement-breakpoint
UPDATE "mcp_oauth_requests"
SET "scopes" = (
  SELECT jsonb_agg(CASE WHEN value IN ('"paperclip:read"', '"paperclip:write"', '"paperclip:configure"', '"paperclip:agent"') THEN to_jsonb('wardmote:' || substr(value #>> '{}', 11)) ELSE value END ORDER BY ordinality)
  FROM jsonb_array_elements("scopes") WITH ORDINALITY
)
WHERE jsonb_typeof("scopes") = 'array'
  AND "scopes" ?| ARRAY['paperclip:read', 'paperclip:write', 'paperclip:configure', 'paperclip:agent'];--> statement-breakpoint
UPDATE "mcp_oauth_device_requests"
SET "scopes" = (
  SELECT jsonb_agg(CASE WHEN value IN ('"paperclip:read"', '"paperclip:write"', '"paperclip:configure"', '"paperclip:agent"') THEN to_jsonb('wardmote:' || substr(value #>> '{}', 11)) ELSE value END ORDER BY ordinality)
  FROM jsonb_array_elements("scopes") WITH ORDINALITY
)
WHERE jsonb_typeof("scopes") = 'array'
  AND "scopes" ?| ARRAY['paperclip:read', 'paperclip:write', 'paperclip:configure', 'paperclip:agent'];--> statement-breakpoint
UPDATE "mcp_event_subscriptions"
SET "name" = 'wardmote.' || substr("name", 11)
WHERE "name" IN ('paperclip.task.status_changed', 'paperclip.task.comment_created', 'paperclip.task.document_updated', 'paperclip.dot.work_available', 'paperclip.dot.mailbox_updated');--> statement-breakpoint
UPDATE "mcp_event_deliveries"
SET "event" = jsonb_set("event", '{name}', to_jsonb('wardmote.' || substr("event" ->> 'name', 11)))
WHERE "event" ->> 'name' IN ('paperclip.task.status_changed', 'paperclip.task.comment_created', 'paperclip.task.document_updated', 'paperclip.dot.work_available', 'paperclip.dot.mailbox_updated');
