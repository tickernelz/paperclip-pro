CREATE TABLE "chat_audit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"conversation_id" uuid,
	"chat_key" text,
	"kind" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_ref" text,
	"run_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content" jsonb,
	"content_purge_at" timestamp with time zone,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_audit_entries_kind_check" CHECK ("chat_audit_entries"."kind" in ('trigger_admitted', 'trigger_filtered', 'message_sent', 'publication_suppressed', 'tool_called', 'approval_requested', 'approval_reminded', 'approval_resolved', 'approval_cancelled', 'config_changed', 'group_added', 'group_left', 'session_health')),
	CONSTRAINT "chat_audit_entries_actor_kind_check" CHECK ("chat_audit_entries"."actor_kind" in ('user', 'agent', 'chat_principal', 'system'))
);
--> statement-breakpoint
CREATE TABLE "chat_endpoint_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"identity_link_id" uuid NOT NULL,
	"added_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_endpoint_owners_company_id_uq" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "chat_outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"chat_key" text NOT NULL,
	"source" text NOT NULL,
	"run_id" uuid,
	"provider_message_id" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"body_hash" text NOT NULL,
	"client_nonce" text NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_outbound_messages_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "chat_outbound_messages_source_check" CHECK ("chat_outbound_messages"."source" in ('tool', 'publication', 'approval')),
	CONSTRAINT "chat_outbound_messages_state_check" CHECK ("chat_outbound_messages"."state" in ('pending', 'sent', 'uncertain', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "chat_owner_approval_bubbles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"outbound_message_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_owner_approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"origin_chat_key" text NOT NULL,
	"origin_conversation_id" uuid,
	"interaction_id" uuid,
	"requested_by_principal_id" uuid,
	"requested_in_run_id" uuid,
	"categories" text[] NOT NULL,
	"scope" text NOT NULL,
	"summary" text NOT NULL,
	"proposed_action" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"resolved_via" text,
	"resolved_by_user_id" text,
	"owner_text" text,
	"agent_conditions" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_owner_approval_requests_company_id_uq" UNIQUE("company_id","id"),
	CONSTRAINT "chat_owner_approval_requests_categories_check" CHECK (cardinality("chat_owner_approval_requests"."categories") > 0 and "chat_owner_approval_requests"."categories" <@ array['create_task', 'external_tools', 'cross_chat_send', 'wa_admin', 'gateway_admin', 'reply_outside_allowlist', 'reply']::text[]),
	CONSTRAINT "chat_owner_approval_requests_scope_check" CHECK ("chat_owner_approval_requests"."scope" in ('one_action', 'requester')),
	CONSTRAINT "chat_owner_approval_requests_status_check" CHECK ("chat_owner_approval_requests"."status" in ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "chat_owner_approval_requests_resolved_via_check" CHECK ("chat_owner_approval_requests"."resolved_via" is null or "chat_owner_approval_requests"."resolved_via" in ('whatsapp', 'paperclip')),
	CONSTRAINT "chat_owner_approval_requests_reminder_count_check" CHECK ("chat_owner_approval_requests"."reminder_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "chat_owner_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"origin_chat_key" text NOT NULL,
	"requester_principal_id" uuid,
	"category" text NOT NULL,
	"scope" text NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"approved_by_user_id" text,
	"approved_via" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_owner_grants_category_check" CHECK ("chat_owner_grants"."category" in ('create_task', 'external_tools', 'cross_chat_send', 'wa_admin', 'gateway_admin', 'reply_outside_allowlist', 'reply')),
	CONSTRAINT "chat_owner_grants_scope_check" CHECK ("chat_owner_grants"."scope" in ('one_action', 'requester')),
	CONSTRAINT "chat_owner_grants_status_check" CHECK ("chat_owner_grants"."status" in ('live', 'consumed', 'revoked', 'expired')),
	CONSTRAINT "chat_owner_grants_approved_via_check" CHECK ("chat_owner_grants"."approved_via" in ('whatsapp', 'paperclip'))
);
--> statement-breakpoint
CREATE TABLE "chat_scheduled_wakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"chat_key" text NOT NULL,
	"kind" text NOT NULL,
	"fire_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"related_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_scheduled_wakes_kind_check" CHECK ("chat_scheduled_wakes"."kind" in ('owner_absent', 'approval_reminder')),
	CONSTRAINT "chat_scheduled_wakes_state_check" CHECK ("chat_scheduled_wakes"."state" in ('pending', 'fired', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "chat_sender_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"list" text NOT NULL,
	"e164" text NOT NULL,
	"label" text,
	"created_by_user_id" text,
	"created_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_sender_rules_list_check" CHECK ("chat_sender_rules"."list" in ('allow', 'deny')),
	CONSTRAINT "chat_sender_rules_e164_check" CHECK ("chat_sender_rules"."e164" ~ '^[+][1-9][0-9]{6,14}$')
);
--> statement-breakpoint
ALTER TABLE "chat_endpoints" DROP CONSTRAINT IF EXISTS "chat_endpoints_provider_check";--> statement-breakpoint
ALTER TABLE "chat_external_principals" DROP CONSTRAINT IF EXISTS "chat_external_principals_provider_check";--> statement-breakpoint
ALTER TABLE "chat_deliveries" ADD COLUMN "trigger_class" text;--> statement-breakpoint
ALTER TABLE "chat_deliveries" ADD COLUMN "principal_role" text;--> statement-breakpoint
ALTER TABLE "chat_deliveries" ADD COLUMN "answer_state" text;--> statement-breakpoint
ALTER TABLE "chat_endpoint_resources" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_endpoints" ADD COLUMN "policy" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_endpoints" ADD COLUMN "policy_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_endpoints" ADD COLUMN "inflight_mode" text DEFAULT 'queue' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_external_principals" ADD COLUMN "alternate_external_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_identity_links" ADD CONSTRAINT "chat_identity_links_company_id_uq" UNIQUE("company_id","id");--> statement-breakpoint
ALTER TABLE "chat_audit_entries" ADD CONSTRAINT "chat_audit_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_audit_entries" ADD CONSTRAINT "chat_audit_entries_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_audit_entries" ADD CONSTRAINT "chat_audit_entries_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_audit_entries" ADD CONSTRAINT "chat_audit_entries_company_endpoint_fk" FOREIGN KEY ("company_id","endpoint_id") REFERENCES "public"."chat_endpoints"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_audit_entries" ADD CONSTRAINT "chat_audit_entries_company_conversation_fk" FOREIGN KEY ("company_id","conversation_id") REFERENCES "public"."chat_conversations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_endpoint_owners" ADD CONSTRAINT "chat_endpoint_owners_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_endpoint_owners" ADD CONSTRAINT "chat_endpoint_owners_company_endpoint_fk" FOREIGN KEY ("company_id","endpoint_id") REFERENCES "public"."chat_endpoints"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_endpoint_owners" ADD CONSTRAINT "chat_endpoint_owners_company_identity_link_fk" FOREIGN KEY ("company_id","identity_link_id") REFERENCES "public"."chat_identity_links"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_outbound_messages" ADD CONSTRAINT "chat_outbound_messages_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_outbound_messages" ADD CONSTRAINT "chat_outbound_messages_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_outbound_messages" ADD CONSTRAINT "chat_outbound_messages_company_endpoint_fk" FOREIGN KEY ("company_id","endpoint_id") REFERENCES "public"."chat_endpoints"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_approval_bubbles" ADD CONSTRAINT "chat_owner_approval_bubbles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_approval_bubbles" ADD CONSTRAINT "chat_owner_approval_bubbles_company_endpoint_fk" FOREIGN KEY ("company_id","endpoint_id") REFERENCES "public"."chat_endpoints"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_approval_bubbles" ADD CONSTRAINT "chat_owner_approval_bubbles_company_request_fk" FOREIGN KEY ("company_id","request_id") REFERENCES "public"."chat_owner_approval_requests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_approval_bubbles" ADD CONSTRAINT "chat_owner_approval_bubbles_company_owner_fk" FOREIGN KEY ("company_id","owner_id") REFERENCES "public"."chat_endpoint_owners"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_approval_bubbles" ADD CONSTRAINT "chat_owner_approval_bubbles_company_outbound_fk" FOREIGN KEY ("company_id","outbound_message_id") REFERENCES "public"."chat_outbound_messages"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_approval_requests" ADD CONSTRAINT "chat_owner_approval_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_approval_requests" ADD CONSTRAINT "chat_owner_approval_requests_origin_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("origin_conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_approval_requests" ADD CONSTRAINT "chat_owner_approval_requests_interaction_id_issue_thread_interactions_id_fk" FOREIGN KEY ("interaction_id") REFERENCES "public"."issue_thread_interactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_approval_requests" ADD CONSTRAINT "chat_owner_approval_requests_requested_by_principal_id_chat_external_principals_id_fk" FOREIGN KEY ("requested_by_principal_id") REFERENCES "public"."chat_external_principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_approval_requests" ADD CONSTRAINT "chat_owner_approval_requests_requested_in_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("requested_in_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_approval_requests" ADD CONSTRAINT "chat_owner_approval_requests_company_endpoint_fk" FOREIGN KEY ("company_id","endpoint_id") REFERENCES "public"."chat_endpoints"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_approval_requests" ADD CONSTRAINT "chat_owner_approval_requests_company_conversation_fk" FOREIGN KEY ("company_id","origin_conversation_id") REFERENCES "public"."chat_conversations"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_approval_requests" ADD CONSTRAINT "chat_owner_approval_requests_company_principal_fk" FOREIGN KEY ("company_id","requested_by_principal_id") REFERENCES "public"."chat_external_principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_grants" ADD CONSTRAINT "chat_owner_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_grants" ADD CONSTRAINT "chat_owner_grants_requester_principal_id_chat_external_principals_id_fk" FOREIGN KEY ("requester_principal_id") REFERENCES "public"."chat_external_principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_grants" ADD CONSTRAINT "chat_owner_grants_consumed_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("consumed_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_grants" ADD CONSTRAINT "chat_owner_grants_company_endpoint_fk" FOREIGN KEY ("company_id","endpoint_id") REFERENCES "public"."chat_endpoints"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_grants" ADD CONSTRAINT "chat_owner_grants_company_request_fk" FOREIGN KEY ("company_id","request_id") REFERENCES "public"."chat_owner_approval_requests"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_owner_grants" ADD CONSTRAINT "chat_owner_grants_company_principal_fk" FOREIGN KEY ("company_id","requester_principal_id") REFERENCES "public"."chat_external_principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_scheduled_wakes" ADD CONSTRAINT "chat_scheduled_wakes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_scheduled_wakes" ADD CONSTRAINT "chat_scheduled_wakes_company_endpoint_fk" FOREIGN KEY ("company_id","endpoint_id") REFERENCES "public"."chat_endpoints"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sender_rules" ADD CONSTRAINT "chat_sender_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sender_rules" ADD CONSTRAINT "chat_sender_rules_created_by_principal_id_chat_external_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."chat_external_principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sender_rules" ADD CONSTRAINT "chat_sender_rules_company_endpoint_fk" FOREIGN KEY ("company_id","endpoint_id") REFERENCES "public"."chat_endpoints"("company_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sender_rules" ADD CONSTRAINT "chat_sender_rules_company_principal_fk" FOREIGN KEY ("company_id","created_by_principal_id") REFERENCES "public"."chat_external_principals"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_audit_entries_endpoint_occurred_idx" ON "chat_audit_entries" USING btree ("endpoint_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "chat_audit_entries_content_purge_idx" ON "chat_audit_entries" USING btree ("content_purge_at") WHERE "chat_audit_entries"."content" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_endpoint_owners_link_uq" ON "chat_endpoint_owners" USING btree ("endpoint_id","identity_link_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_outbound_messages_provider_message_uq" ON "chat_outbound_messages" USING btree ("endpoint_id","provider_message_id") WHERE "chat_outbound_messages"."provider_message_id" is not null;--> statement-breakpoint
CREATE INDEX "chat_outbound_messages_chat_state_idx" ON "chat_outbound_messages" USING btree ("endpoint_id","chat_key","state");--> statement-breakpoint
CREATE INDEX "chat_outbound_messages_sent_at_idx" ON "chat_outbound_messages" USING btree ("endpoint_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_owner_approval_bubbles_outbound_uq" ON "chat_owner_approval_bubbles" USING btree ("endpoint_id","outbound_message_id");--> statement-breakpoint
CREATE INDEX "chat_owner_approval_bubbles_request_idx" ON "chat_owner_approval_bubbles" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "chat_owner_approval_requests_status_idx" ON "chat_owner_approval_requests" USING btree ("endpoint_id","status");--> statement-breakpoint
CREATE INDEX "chat_owner_grants_lookup_idx" ON "chat_owner_grants" USING btree ("endpoint_id","origin_chat_key","requester_principal_id","status");--> statement-breakpoint
CREATE INDEX "chat_owner_grants_request_idx" ON "chat_owner_grants" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "chat_scheduled_wakes_pending_fire_idx" ON "chat_scheduled_wakes" USING btree ("fire_at") WHERE "chat_scheduled_wakes"."state" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "chat_scheduled_wakes_pending_absent_uq" ON "chat_scheduled_wakes" USING btree ("endpoint_id","chat_key") WHERE "chat_scheduled_wakes"."kind" = 'owner_absent' and "chat_scheduled_wakes"."state" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "chat_sender_rules_entry_uq" ON "chat_sender_rules" USING btree ("endpoint_id","list","e164");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_endpoints_openwa_account_uq" ON "chat_endpoints" USING btree ("provider_account_id") WHERE "chat_endpoints"."provider" = 'openwa' and "chat_endpoints"."status" <> 'archived' and "chat_endpoints"."provider_account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_endpoints_openwa_number_uq" ON "chat_endpoints" USING btree ("bot_external_id") WHERE "chat_endpoints"."provider" = 'openwa' and "chat_endpoints"."status" <> 'archived' and "chat_endpoints"."bot_external_id" is not null;--> statement-breakpoint
ALTER TABLE "chat_deliveries" ADD CONSTRAINT "chat_deliveries_trigger_class_check" CHECK ("chat_deliveries"."trigger_class" is null or "chat_deliveries"."trigger_class" in ('owner', 'other', 'grant'));--> statement-breakpoint
ALTER TABLE "chat_deliveries" ADD CONSTRAINT "chat_deliveries_principal_role_check" CHECK ("chat_deliveries"."principal_role" is null or "chat_deliveries"."principal_role" in ('owner', 'allowed', 'outside_allowlist', 'denylisted'));--> statement-breakpoint
ALTER TABLE "chat_deliveries" ADD CONSTRAINT "chat_deliveries_answer_state_check" CHECK ("chat_deliveries"."answer_state" is null or "chat_deliveries"."answer_state" in ('pending', 'answered', 'silenced', 'handed_off'));--> statement-breakpoint
ALTER TABLE "chat_endpoints" ADD CONSTRAINT "chat_endpoints_inflight_mode_check" CHECK ("chat_endpoints"."inflight_mode" in ('steer', 'queue'));--> statement-breakpoint
ALTER TABLE "chat_endpoints" ADD CONSTRAINT "chat_endpoints_policy_revision_check" CHECK ("chat_endpoints"."policy_revision" >= 0);--> statement-breakpoint
ALTER TABLE "chat_endpoints" ADD CONSTRAINT "chat_endpoints_provider_check" CHECK ("chat_endpoints"."provider" in ('slack', 'github', 'discord', 'microsoft-teams', 'telegram', 'agentmail', 'imessage-photon', 'openwa'));--> statement-breakpoint
ALTER TABLE "chat_external_principals" ADD CONSTRAINT "chat_external_principals_provider_check" CHECK ("chat_external_principals"."provider" in ('slack', 'github', 'discord', 'microsoft-teams', 'telegram', 'agentmail', 'imessage-photon', 'openwa'));