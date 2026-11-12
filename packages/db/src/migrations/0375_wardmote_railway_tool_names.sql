UPDATE "tool_catalog_entries"
SET "name" = 'wardmote-railway-' || substr("name", length('paperclip-railway-') + 1),
    "tool_name" = 'wardmote-railway-' || substr("tool_name", length('paperclip-railway-') + 1)
WHERE "tool_name" LIKE 'paperclip-railway-%'
  AND "name" LIKE 'paperclip-railway-%';--> statement-breakpoint
UPDATE "tool_profile_entries"
SET "tool_name" = 'wardmote-railway-' || substr("tool_name", length('paperclip-railway-') + 1)
WHERE "tool_name" LIKE 'paperclip-railway-%';
