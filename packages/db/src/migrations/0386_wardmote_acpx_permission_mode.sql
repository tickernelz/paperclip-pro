UPDATE "agents"
SET "adapter_config" = jsonb_set("adapter_config", '{acpxPermissionMode}', '"approve-wardmote"')
WHERE "adapter_config"->>'acpxPermissionMode' = 'approve-paperclip';--> statement-breakpoint
UPDATE "agent_config_revisions"
SET "before_config" = jsonb_set("before_config", '{adapterConfig,acpxPermissionMode}', '"approve-wardmote"')
WHERE "before_config"#>>'{adapterConfig,acpxPermissionMode}' = 'approve-paperclip';--> statement-breakpoint
UPDATE "agent_config_revisions"
SET "after_config" = jsonb_set("after_config", '{adapterConfig,acpxPermissionMode}', '"approve-wardmote"')
WHERE "after_config"#>>'{adapterConfig,acpxPermissionMode}' = 'approve-paperclip';
