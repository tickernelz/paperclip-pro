CREATE TABLE "chat_openwa_linked_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"label" text NOT NULL,
	"phone_masked" text,
	"push_name" text,
	"secret_id" uuid NOT NULL,
	"gateway_key_id" text NOT NULL,
	"allowed_chats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_openwa_linked_sessions_status_check" CHECK ("chat_openwa_linked_sessions"."status" in ('active', 'unavailable'))
);
--> statement-breakpoint
ALTER TABLE "chat_audit_entries" DROP CONSTRAINT IF EXISTS "chat_audit_entries_kind_check";--> statement-breakpoint
ALTER TABLE "chat_openwa_linked_sessions" ADD CONSTRAINT "chat_openwa_linked_sessions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_openwa_linked_sessions" ADD CONSTRAINT "chat_openwa_linked_sessions_company_endpoint_fk" FOREIGN KEY ("company_id","endpoint_id") REFERENCES "public"."chat_endpoints"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_openwa_linked_sessions_endpoint_session_uq" ON "chat_openwa_linked_sessions" USING btree ("endpoint_id","session_id");--> statement-breakpoint
ALTER TABLE "chat_audit_entries" ADD CONSTRAINT "chat_audit_entries_kind_check" CHECK ("chat_audit_entries"."kind" in ('trigger_admitted', 'trigger_filtered', 'message_sent', 'publication_suppressed', 'tool_called', 'approval_requested', 'approval_reminded', 'approval_resolved', 'approval_cancelled', 'config_changed', 'group_added', 'group_left', 'session_health', 'linked_read'));