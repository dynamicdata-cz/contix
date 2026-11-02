CREATE TABLE "soc_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"kind" varchar(30) NOT NULL,
	"target" varchar(500) NOT NULL,
	"agent_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(20) DEFAULT 'proposed' NOT NULL,
	"alert_id" uuid,
	"case_id" uuid,
	"requested_by_id" uuid,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"executed_by_id" uuid,
	"executed_at" timestamp with time zone,
	"result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "soc_actions" ADD CONSTRAINT "soc_actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_actions" ADD CONSTRAINT "soc_actions_alert_id_alert_suggestions_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alert_suggestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_actions" ADD CONSTRAINT "soc_actions_case_id_soc_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."soc_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_actions" ADD CONSTRAINT "soc_actions_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_actions" ADD CONSTRAINT "soc_actions_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_actions" ADD CONSTRAINT "soc_actions_executed_by_id_users_id_fk" FOREIGN KEY ("executed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "soc_actions_company_idx" ON "soc_actions" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "soc_actions_alert_idx" ON "soc_actions" USING btree ("alert_id");