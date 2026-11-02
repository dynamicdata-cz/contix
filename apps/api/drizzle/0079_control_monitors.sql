CREATE TABLE "control_monitor_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"result" varchar(10) NOT NULL,
	"value" real,
	"threshold" real,
	"population" integer,
	"exceptions" integer,
	"summary" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"control_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"name" varchar(200) DEFAULT '' NOT NULL,
	"frequency" varchar(20) DEFAULT 'daily' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_result" varchar(10),
	"last_summary" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_tests" ADD COLUMN "monitor_id" uuid;--> statement-breakpoint
ALTER TABLE "control_monitor_runs" ADD CONSTRAINT "control_monitor_runs_monitor_id_control_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."control_monitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_monitor_runs" ADD CONSTRAINT "control_monitor_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_monitors" ADD CONSTRAINT "control_monitors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_monitors" ADD CONSTRAINT "control_monitors_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_monitors" ADD CONSTRAINT "control_monitors_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "control_monitor_runs_monitor_idx" ON "control_monitor_runs" USING btree ("monitor_id","run_at");--> statement-breakpoint
CREATE INDEX "control_monitors_company_idx" ON "control_monitors" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "control_monitors_control_idx" ON "control_monitors" USING btree ("control_id");--> statement-breakpoint
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_monitor_id_control_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."control_monitors"("id") ON DELETE set null ON UPDATE no action;