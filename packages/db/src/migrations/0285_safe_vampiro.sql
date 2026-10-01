CREATE TABLE "pixels_office_seats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"character_index" integer DEFAULT 0 NOT NULL,
	"seat_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pixels_office_seats" ADD CONSTRAINT "pixels_office_seats_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pixels_office_seats" ADD CONSTRAINT "pixels_office_seats_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pixels_office_seats_company_agent_idx" ON "pixels_office_seats" USING btree ("company_id","agent_id");--> statement-breakpoint
CREATE INDEX "pixels_office_seats_company_idx" ON "pixels_office_seats" USING btree ("company_id");