CREATE TABLE "issue_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"created_by_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_agent_id" uuid,
	"revoked_by_user_id" text
);
--> statement-breakpoint
ALTER TABLE "issue_comments" ADD COLUMN "public_share_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_share_links" ADD CONSTRAINT "issue_share_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_share_links" ADD CONSTRAINT "issue_share_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_share_links" ADD CONSTRAINT "issue_share_links_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_share_links" ADD CONSTRAINT "issue_share_links_created_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("created_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_share_links" ADD CONSTRAINT "issue_share_links_revoked_by_agent_id_agents_id_fk" FOREIGN KEY ("revoked_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_share_links_token_uq" ON "issue_share_links" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_share_links_active_issue_uq" ON "issue_share_links" USING btree ("issue_id") WHERE "issue_share_links"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "issue_share_links_company_issue_idx" ON "issue_share_links" USING btree ("company_id","issue_id");