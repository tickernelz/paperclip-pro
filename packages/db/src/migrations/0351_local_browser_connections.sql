CREATE TABLE "local_browser_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"created_by_user_id" text,
	"created_by_agent_id" uuid,
	"label" text NOT NULL,
	"client" text DEFAULT 'chromium' NOT NULL,
	"client_version" text DEFAULT '' NOT NULL,
	"profile_name" text,
	"tier" text DEFAULT 'refine' NOT NULL,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_browser_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"tier" text DEFAULT 'refine' NOT NULL,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_by_user_id" text,
	"updated_by_agent_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "local_browser_connections" ADD CONSTRAINT "local_browser_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_browser_connections" ADD CONSTRAINT "local_browser_connections_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_browser_settings" ADD CONSTRAINT "local_browser_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_browser_settings" ADD CONSTRAINT "local_browser_settings_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "local_browser_connections_token_uq" ON "local_browser_connections" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "local_browser_connections_company_idx" ON "local_browser_connections" USING btree ("company_id","created_at");