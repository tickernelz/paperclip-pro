CREATE TABLE "issue_autonomy_windows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"root_issue_id" uuid NOT NULL,
	"granted_by_user_id" text NOT NULL,
	"granted_via" text NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_accepts" integer,
	"accept_count" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by_user_id" text,
	CONSTRAINT "issue_autonomy_windows_granted_via_check" CHECK ("issue_autonomy_windows"."granted_via" in ('whatsapp', 'paperclip')),
	CONSTRAINT "issue_autonomy_windows_status_check" CHECK ("issue_autonomy_windows"."status" in ('live', 'revoked', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "issue_autonomy_windows" ADD CONSTRAINT "issue_autonomy_windows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_autonomy_windows" ADD CONSTRAINT "issue_autonomy_windows_root_issue_id_issues_id_fk" FOREIGN KEY ("root_issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_autonomy_windows_company_status_expires_idx" ON "issue_autonomy_windows" USING btree ("company_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "issue_autonomy_windows_company_root_status_idx" ON "issue_autonomy_windows" USING btree ("company_id","root_issue_id","status");