UPDATE "tool_profile_entries"
SET "tool_name" = 'wardmote-self:' || substr("tool_name", length('paperclip-self:') + 1)
WHERE "tool_name" LIKE 'paperclip-self:%';--> statement-breakpoint
UPDATE "tool_policies"
SET "selectors" = replace(replace("selectors"::text, '"tool:paperclip-self:', '"tool:wardmote-self:'), '"paperclip-self:', '"wardmote-self:')::jsonb
WHERE ("selectors"::text LIKE '%"paperclip-self:%' OR "selectors"::text LIKE '%"tool:paperclip-self:%');--> statement-breakpoint
UPDATE "tool_policies"
SET "conditions" = replace(replace("conditions"::text, '"tool:paperclip-self:', '"tool:wardmote-self:'), '"paperclip-self:', '"wardmote-self:')::jsonb
WHERE ("conditions"::text LIKE '%"paperclip-self:%' OR "conditions"::text LIKE '%"tool:paperclip-self:%');--> statement-breakpoint
UPDATE "tool_profile_entries"
SET "conditions" = replace(replace("conditions"::text, '"tool:paperclip-self:', '"tool:wardmote-self:'), '"paperclip-self:', '"wardmote-self:')::jsonb
WHERE ("conditions"::text LIKE '%"paperclip-self:%' OR "conditions"::text LIKE '%"tool:paperclip-self:%');--> statement-breakpoint
UPDATE "principal_permission_grants"
SET "scope" = replace(replace("scope"::text, '"tool:paperclip-self:', '"tool:wardmote-self:'), '"paperclip-self:', '"wardmote-self:')::jsonb
WHERE ("scope"::text LIKE '%"paperclip-self:%' OR "scope"::text LIKE '%"tool:paperclip-self:%')
  AND "permission_key" = 'tools:use';
