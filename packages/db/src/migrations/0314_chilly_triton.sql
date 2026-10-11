CREATE TABLE "model_cooldowns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"selector" text NOT NULL,
	"cooldown_until" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"source_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_cooldowns" ADD CONSTRAINT "model_cooldowns_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "model_cooldowns_company_selector_uq" ON "model_cooldowns" USING btree ("company_id","selector");--> statement-breakpoint
CREATE INDEX "model_cooldowns_company_until_idx" ON "model_cooldowns" USING btree ("company_id","cooldown_until");