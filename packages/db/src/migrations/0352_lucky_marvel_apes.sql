CREATE TABLE "terminal_ssh_hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"destination" text NOT NULL,
	"port" integer,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "terminal_ssh_hosts" ADD CONSTRAINT "terminal_ssh_hosts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "terminal_ssh_hosts_company_name_uq" ON "terminal_ssh_hosts" USING btree ("company_id","name");