CREATE TABLE "regulation_registrations" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notified_at" date,
	"notified_ref" varchar(200),
	"notified_snapshot" jsonb,
	"changed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sec_test_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"scope_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"test_ids" text[] NOT NULL,
	"targets" text[] NOT NULL,
	"ports" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"probe_id" uuid,
	"interval_days" integer DEFAULT 7 NOT NULL,
	"auto_follow" boolean DEFAULT true NOT NULL,
	"auto_ai" boolean DEFAULT false NOT NULL,
	"auto_tasks" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sec_test_batches" ADD COLUMN "schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "sec_test_findings" ADD COLUMN "control_id" uuid;--> statement-breakpoint
ALTER TABLE "sec_test_runs" ADD COLUMN "retest_finding_id" uuid;--> statement-breakpoint
ALTER TABLE "regulation_registrations" ADD CONSTRAINT "regulation_registrations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_test_schedules" ADD CONSTRAINT "sec_test_schedules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_test_schedules" ADD CONSTRAINT "sec_test_schedules_scope_id_sec_test_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."sec_test_scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_test_schedules" ADD CONSTRAINT "sec_test_schedules_probe_id_connections_id_fk" FOREIGN KEY ("probe_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_test_schedules" ADD CONSTRAINT "sec_test_schedules_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sec_test_schedules_next_idx" ON "sec_test_schedules" USING btree ("enabled","next_run_at");--> statement-breakpoint
ALTER TABLE "sec_test_findings" ADD CONSTRAINT "sec_test_findings_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE set null ON UPDATE no action;