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
WHERE "payload" -> 'questionSet' ->> 'schema' = 'paperclip.question_set.v1';
