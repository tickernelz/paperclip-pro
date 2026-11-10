ALTER TABLE "tool_connections" DROP CONSTRAINT "tool_connections_credential_source_check";--> statement-breakpoint
ALTER TABLE "tool_connections" DROP CONSTRAINT "tool_connections_credential_source_one_of_check";--> statement-breakpoint
UPDATE "tool_connections" SET "credential_source" = 'wardmote_vault' WHERE "credential_source" = 'paperclip_vault';--> statement-breakpoint
UPDATE "company_secrets" SET "managed_mode" = 'wardmote_managed' WHERE "managed_mode" = 'paperclip_managed';--> statement-breakpoint
UPDATE "user_secret_definitions" SET "managed_mode" = 'wardmote_managed' WHERE "managed_mode" = 'paperclip_managed';--> statement-breakpoint
ALTER TABLE "company_secrets" ALTER COLUMN "managed_mode" SET DEFAULT 'wardmote_managed';--> statement-breakpoint
ALTER TABLE "tool_connections" ALTER COLUMN "credential_source" SET DEFAULT 'wardmote_vault';--> statement-breakpoint
ALTER TABLE "user_secret_definitions" ALTER COLUMN "managed_mode" SET DEFAULT 'wardmote_managed';--> statement-breakpoint
ALTER TABLE "tool_connections" ADD CONSTRAINT "tool_connections_credential_source_check" CHECK ("tool_connections"."credential_source" in ('wardmote_vault', 'vercel_connect'));--> statement-breakpoint
ALTER TABLE "tool_connections" ADD CONSTRAINT "tool_connections_credential_source_one_of_check" CHECK ((
      ("tool_connections"."credential_source" = 'wardmote_vault' and "tool_connections"."external_credential" is null)
      or
      ("tool_connections"."credential_source" = 'vercel_connect' and "tool_connections"."external_credential" is not null and jsonb_array_length("tool_connections"."credential_refs") = 0 and jsonb_array_length("tool_connections"."credential_secret_refs") = 0)
    ));