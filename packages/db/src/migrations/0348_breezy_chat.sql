CREATE TABLE IF NOT EXISTS "issue_thread_interaction_owner_relays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"interaction_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"owner_message_ref" text NOT NULL,
	"claim_key" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"relayed_by_agent_id" uuid NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "issue_thread_interactions" ADD COLUMN IF NOT EXISTS "resolution_relay" jsonb;--> statement-breakpoint
ALTER TABLE "issue_thread_interaction_owner_relays" DROP CONSTRAINT IF EXISTS "issue_thread_interaction_owner_relays_company_id_companies_id_fk";--> statement-breakpoint
ALTER TABLE "issue_thread_interaction_owner_relays" ADD CONSTRAINT "issue_thread_interaction_owner_relays_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interaction_owner_relays" DROP CONSTRAINT IF EXISTS "issue_thread_interaction_owner_relays_issue_id_issues_id_fk";--> statement-breakpoint
ALTER TABLE "issue_thread_interaction_owner_relays" ADD CONSTRAINT "issue_thread_interaction_owner_relays_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interaction_owner_relays" DROP CONSTRAINT IF EXISTS "issue_thread_interaction_owner_relays_interaction_id_issue_thread_interactions_id_fk";--> statement-breakpoint
ALTER TABLE "issue_thread_interaction_owner_relays" ADD CONSTRAINT "issue_thread_interaction_owner_relays_interaction_id_issue_thread_interactions_id_fk" FOREIGN KEY ("interaction_id") REFERENCES "public"."issue_thread_interactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interaction_owner_relays" DROP CONSTRAINT IF EXISTS "issue_thread_interaction_owner_relays_relayed_by_agent_id_agents_id_fk";--> statement-breakpoint
ALTER TABLE "issue_thread_interaction_owner_relays" ADD CONSTRAINT "issue_thread_interaction_owner_relays_relayed_by_agent_id_agents_id_fk" FOREIGN KEY ("relayed_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_thread_interaction_owner_relays" DROP CONSTRAINT IF EXISTS "issue_thread_interaction_owner_relays_run_id_heartbeat_runs_id_fk";--> statement-breakpoint
ALTER TABLE "issue_thread_interaction_owner_relays" ADD CONSTRAINT "issue_thread_interaction_owner_relays_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "issue_thread_interaction_owner_relays_message_claim_uq" ON "issue_thread_interaction_owner_relays" USING btree ("company_id","channel","owner_message_ref","claim_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "issue_thread_interaction_owner_relays_interaction_idx" ON "issue_thread_interaction_owner_relays" USING btree ("interaction_id");
