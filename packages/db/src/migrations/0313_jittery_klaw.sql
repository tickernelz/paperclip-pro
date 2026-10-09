ALTER TABLE "chat_completion_deliveries" ADD COLUMN "response_action_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_task_handoffs" ADD COLUMN "channel" text DEFAULT 'board' NOT NULL;