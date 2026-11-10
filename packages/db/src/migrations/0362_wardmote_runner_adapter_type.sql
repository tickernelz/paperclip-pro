UPDATE "agents" SET "adapter_type" = 'wardmote_runner' WHERE "adapter_type" = 'paperclip_runner';--> statement-breakpoint
UPDATE "agent_runtime_state" SET "adapter_type" = 'wardmote_runner' WHERE "adapter_type" = 'paperclip_runner';--> statement-breakpoint
UPDATE "agent_task_sessions" AS legacy SET "adapter_type" = 'wardmote_runner'
WHERE legacy."adapter_type" = 'paperclip_runner'
  AND NOT EXISTS (
    SELECT 1 FROM "agent_task_sessions" AS current
    WHERE current."company_id" = legacy."company_id"
      AND current."agent_id" = legacy."agent_id"
      AND current."adapter_type" = 'wardmote_runner'
      AND current."task_key" = legacy."task_key"
  );--> statement-breakpoint
UPDATE "adapter_auth_sessions" SET "adapter_type" = 'wardmote_runner' WHERE "adapter_type" = 'paperclip_runner';--> statement-breakpoint
UPDATE "join_requests" SET "adapter_type" = 'wardmote_runner' WHERE "adapter_type" = 'paperclip_runner';--> statement-breakpoint
UPDATE "finance_events" SET "execution_adapter_type" = 'wardmote_runner' WHERE "execution_adapter_type" = 'paperclip_runner';--> statement-breakpoint
UPDATE "agent_config_revisions"
SET
  "before_config" = CASE
    WHEN "before_config" ->> 'adapterType' = 'paperclip_runner'
    THEN jsonb_set("before_config", '{adapterType}', '"wardmote_runner"')
    ELSE "before_config"
  END,
  "after_config" = CASE
    WHEN "after_config" ->> 'adapterType' = 'paperclip_runner'
    THEN jsonb_set("after_config", '{adapterType}', '"wardmote_runner"')
    ELSE "after_config"
  END
WHERE "before_config" ->> 'adapterType' = 'paperclip_runner'
   OR "after_config" ->> 'adapterType' = 'paperclip_runner';--> statement-breakpoint
UPDATE "approvals"
SET "payload" = jsonb_set("payload", '{adapterType}', '"wardmote_runner"')
WHERE "payload" ->> 'adapterType' = 'paperclip_runner';--> statement-breakpoint
UPDATE "issue_comments"
SET "metadata" = jsonb_set("metadata", '{authorizationReason}', '"wardmote_runner_protocol"')
WHERE "metadata" ->> 'authorizationReason' = 'paperclip_runner_protocol';
