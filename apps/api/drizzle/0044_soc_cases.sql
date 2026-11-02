CREATE TABLE "soc_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"seq" serial NOT NULL,
	"title" varchar(300) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"auto" boolean DEFAULT false NOT NULL,
	"correlation_key" varchar(200),
	"assignee_id" uuid,
	"acknowledged_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"verdict" varchar(20),
	"close_reason" text,
	"incident_id" uuid,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "soc_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"rule_id" varchar(50) NOT NULL,
	"agent_id" varchar(50),
	"srcip" varchar(64),
	"reason" text NOT NULL,
	"until" date NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"source_alert_id" uuid,
	"created_by_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "soc_cases" ADD CONSTRAINT "soc_cases_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_cases" ADD CONSTRAINT "soc_cases_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_cases" ADD CONSTRAINT "soc_cases_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_cases" ADD CONSTRAINT "soc_cases_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_suppressions" ADD CONSTRAINT "soc_suppressions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_suppressions" ADD CONSTRAINT "soc_suppressions_source_alert_id_alert_suggestions_id_fk" FOREIGN KEY ("source_alert_id") REFERENCES "public"."alert_suggestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_suppressions" ADD CONSTRAINT "soc_suppressions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_suppressions" ADD CONSTRAINT "soc_suppressions_revoked_by_id_users_id_fk" FOREIGN KEY ("revoked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "soc_cases_company_idx" ON "soc_cases" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "soc_suppressions_rule_idx" ON "soc_suppressions" USING btree ("rule_id");--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD CONSTRAINT "alert_suggestions_case_id_soc_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."soc_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_suggestions_case_idx" ON "alert_suggestions" USING btree ("case_id");