UPDATE "agent_instruction_working_copies"
SET "receipt" = jsonb_set("receipt", '{schema}', '"wardmote.agent-files.v1"')
WHERE "receipt" ->> 'schema' = 'paperclip.agent-files.v1';--> statement-breakpoint
UPDATE "heartbeat_runs"
SET "result_json" = jsonb_set("result_json", '{presentationDecision,schema}', '"wardmote.run_presentation_decision.v1"')
WHERE "result_json" -> 'presentationDecision' ->> 'schema' = 'paperclip.run_presentation_decision.v1';--> statement-breakpoint
UPDATE "heartbeat_run_events"
SET "payload" = jsonb_set("payload", '{presentationDecision,schema}', '"wardmote.run_presentation_decision.v1"')
WHERE "payload" -> 'presentationDecision' ->> 'schema' = 'paperclip.run_presentation_decision.v1'
  AND "source_payload_sha256" IS NULL;--> statement-breakpoint
UPDATE "issue_thread_interactions"
SET "payload" = jsonb_set("payload", '{questionSet,schema}', '"wardmote.question_set.v1"')
WHERE "payload" -> 'questionSet' ->> 'schema' = 'paperclip.question_set.v1';--> statement-breakpoint
UPDATE "environment_leases"
SET "metadata" = jsonb_set("metadata", '{remoteExecutionTermination,schema}', to_jsonb('wardmote.' || substr("metadata" #>> '{remoteExecutionTermination,schema}', 11)))
WHERE "metadata" #>> '{remoteExecutionTermination,schema}' LIKE 'paperclip.%';--> statement-breakpoint
UPDATE "environment_leases"
SET "metadata" = jsonb_set("metadata", '{sandboxStopAndRetainReceipt,schema}', to_jsonb('wardmote.' || substr("metadata" #>> '{sandboxStopAndRetainReceipt,schema}', 11)))
WHERE "metadata" #>> '{sandboxStopAndRetainReceipt,schema}' LIKE 'paperclip.%';--> statement-breakpoint
UPDATE "environment_leases"
SET "metadata" = jsonb_set("metadata", '{sandboxStopAndRetain,schema}', to_jsonb('wardmote.' || substr("metadata" #>> '{sandboxStopAndRetain,schema}', 11)))
WHERE "metadata" #>> '{sandboxStopAndRetain,schema}' LIKE 'paperclip.%';--> statement-breakpoint
UPDATE "environment_leases"
SET "metadata" = jsonb_set("metadata", '{nativeWorkspaceExportResume,schema}', to_jsonb('wardmote.' || substr("metadata" #>> '{nativeWorkspaceExportResume,schema}', 11)))
WHERE "metadata" #>> '{nativeWorkspaceExportResume,schema}' LIKE 'paperclip.%';--> statement-breakpoint
UPDATE "chat_actions"
SET "payload" = jsonb_set("payload", '{registration,schema}', to_jsonb('wardmote.' || substr("payload" #>> '{registration,schema}', 11)))
WHERE "payload" #>> '{registration,schema}' LIKE 'paperclip.%';--> statement-breakpoint
UPDATE "chat_deliveries"
SET "normalized_event" = jsonb_set("normalized_event", '{teamsPersonalRecipient,schema}', to_jsonb('wardmote.' || substr("normalized_event" #>> '{teamsPersonalRecipient,schema}', 11)))
WHERE "normalized_event" #>> '{teamsPersonalRecipient,schema}' LIKE 'paperclip.%';
