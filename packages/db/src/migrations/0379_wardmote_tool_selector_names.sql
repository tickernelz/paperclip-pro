UPDATE "tool_policies" AS r
SET "selectors" = replace(replace(r."selectors"::text, '"tool:paperclip-railway-', '"tool:wardmote-railway-'), '"paperclip-railway-', '"wardmote-railway-')::jsonb
WHERE (r."selectors"::text LIKE '%"paperclip-railway-%' OR r."selectors"::text LIKE '%"tool:paperclip-railway-%');--> statement-breakpoint
UPDATE "tool_policies" AS r
SET "selectors" = replace(r."selectors"::text, '"paperclip.examples.safe-read-only-todo-kv"', '"wardmote.examples.safe-read-only-todo-kv"')::jsonb
WHERE r."selectors"::text LIKE '%"paperclip.examples.safe-read-only-todo-kv"%';--> statement-breakpoint
UPDATE "tool_policies" AS r
SET "selectors" = replace(r."selectors"::text, '"paperclip.pages"', '"wardmote-pages"')::jsonb
WHERE r."selectors"::text LIKE '%"paperclip.pages"%'
  AND NOT EXISTS (
    SELECT 1 FROM "tool_applications" AS a
    WHERE a."company_id" = r."company_id" AND a."application_key" = 'paperclip.pages'
  );--> statement-breakpoint
UPDATE "tool_policies" AS r
SET "selectors" = replace(r."selectors"::text, '"pages.paperclip"', '"wardmote-pages"')::jsonb
WHERE r."selectors"::text LIKE '%"pages.paperclip"%'
  AND NOT EXISTS (
    SELECT 1 FROM "tool_applications" AS a
    WHERE a."company_id" = r."company_id" AND a."application_key" = 'pages.paperclip'
  );--> statement-breakpoint
UPDATE "tool_policies" AS r
SET "conditions" = replace(replace(r."conditions"::text, '"tool:paperclip-railway-', '"tool:wardmote-railway-'), '"paperclip-railway-', '"wardmote-railway-')::jsonb
WHERE (r."conditions"::text LIKE '%"paperclip-railway-%' OR r."conditions"::text LIKE '%"tool:paperclip-railway-%');--> statement-breakpoint
UPDATE "tool_policies" AS r
SET "conditions" = replace(r."conditions"::text, '"paperclip.examples.safe-read-only-todo-kv"', '"wardmote.examples.safe-read-only-todo-kv"')::jsonb
WHERE r."conditions"::text LIKE '%"paperclip.examples.safe-read-only-todo-kv"%';--> statement-breakpoint
UPDATE "tool_policies" AS r
SET "conditions" = replace(r."conditions"::text, '"paperclip.pages"', '"wardmote-pages"')::jsonb
WHERE r."conditions"::text LIKE '%"paperclip.pages"%'
  AND NOT EXISTS (
    SELECT 1 FROM "tool_applications" AS a
    WHERE a."company_id" = r."company_id" AND a."application_key" = 'paperclip.pages'
  );--> statement-breakpoint
UPDATE "tool_policies" AS r
SET "conditions" = replace(r."conditions"::text, '"pages.paperclip"', '"wardmote-pages"')::jsonb
WHERE r."conditions"::text LIKE '%"pages.paperclip"%'
  AND NOT EXISTS (
    SELECT 1 FROM "tool_applications" AS a
    WHERE a."company_id" = r."company_id" AND a."application_key" = 'pages.paperclip'
  );--> statement-breakpoint
UPDATE "tool_profile_entries" AS r
SET "conditions" = replace(replace(r."conditions"::text, '"tool:paperclip-railway-', '"tool:wardmote-railway-'), '"paperclip-railway-', '"wardmote-railway-')::jsonb
WHERE (r."conditions"::text LIKE '%"paperclip-railway-%' OR r."conditions"::text LIKE '%"tool:paperclip-railway-%');--> statement-breakpoint
UPDATE "tool_profile_entries" AS r
SET "conditions" = replace(r."conditions"::text, '"paperclip.examples.safe-read-only-todo-kv"', '"wardmote.examples.safe-read-only-todo-kv"')::jsonb
WHERE r."conditions"::text LIKE '%"paperclip.examples.safe-read-only-todo-kv"%';--> statement-breakpoint
UPDATE "tool_profile_entries" AS r
SET "conditions" = replace(r."conditions"::text, '"paperclip.pages"', '"wardmote-pages"')::jsonb
WHERE r."conditions"::text LIKE '%"paperclip.pages"%'
  AND NOT EXISTS (
    SELECT 1 FROM "tool_applications" AS a
    WHERE a."company_id" = r."company_id" AND a."application_key" = 'paperclip.pages'
  );--> statement-breakpoint
UPDATE "tool_profile_entries" AS r
SET "conditions" = replace(r."conditions"::text, '"pages.paperclip"', '"wardmote-pages"')::jsonb
WHERE r."conditions"::text LIKE '%"pages.paperclip"%'
  AND NOT EXISTS (
    SELECT 1 FROM "tool_applications" AS a
    WHERE a."company_id" = r."company_id" AND a."application_key" = 'pages.paperclip'
  );--> statement-breakpoint
UPDATE "principal_permission_grants" AS r
SET "scope" = replace(replace(r."scope"::text, '"tool:paperclip-railway-', '"tool:wardmote-railway-'), '"paperclip-railway-', '"wardmote-railway-')::jsonb
WHERE (r."scope"::text LIKE '%"paperclip-railway-%' OR r."scope"::text LIKE '%"tool:paperclip-railway-%')
  AND r."permission_key" = 'tools:use';--> statement-breakpoint
UPDATE "principal_permission_grants" AS r
SET "scope" = replace(r."scope"::text, '"paperclip.examples.safe-read-only-todo-kv"', '"wardmote.examples.safe-read-only-todo-kv"')::jsonb
WHERE r."scope"::text LIKE '%"paperclip.examples.safe-read-only-todo-kv"%'
  AND r."permission_key" = 'tools:use';--> statement-breakpoint
UPDATE "principal_permission_grants" AS r
SET "scope" = replace(r."scope"::text, '"paperclip.pages"', '"wardmote-pages"')::jsonb
WHERE r."scope"::text LIKE '%"paperclip.pages"%'
  AND r."permission_key" = 'tools:use'
  AND NOT EXISTS (
    SELECT 1 FROM "tool_applications" AS a
    WHERE a."company_id" = r."company_id" AND a."application_key" = 'paperclip.pages'
  );--> statement-breakpoint
UPDATE "principal_permission_grants" AS r
SET "scope" = replace(r."scope"::text, '"pages.paperclip"', '"wardmote-pages"')::jsonb
WHERE r."scope"::text LIKE '%"pages.paperclip"%'
  AND r."permission_key" = 'tools:use'
  AND NOT EXISTS (
    SELECT 1 FROM "tool_applications" AS a
    WHERE a."company_id" = r."company_id" AND a."application_key" = 'pages.paperclip'
  );
