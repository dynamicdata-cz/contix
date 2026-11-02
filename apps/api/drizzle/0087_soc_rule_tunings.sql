CREATE TABLE "soc_rule_tunings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"seq" serial NOT NULL,
	"rule_id" varchar(20) NOT NULL,
	"rule_description" text DEFAULT '' NOT NULL,
	"kind" varchar(20) NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"new_level" smallint,
	"rationale" text DEFAULT '' NOT NULL,
	"source" varchar(10) DEFAULT 'manual' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"simulation" jsonb,
	"created_by_id" uuid,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "soc_rule_tunings" ADD CONSTRAINT "soc_rule_tunings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_rule_tunings" ADD CONSTRAINT "soc_rule_tunings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_rule_tunings" ADD CONSTRAINT "soc_rule_tunings_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "soc_rule_tunings_company_idx" ON "soc_rule_tunings" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "soc_rule_tunings_rule_idx" ON "soc_rule_tunings" USING btree ("rule_id");