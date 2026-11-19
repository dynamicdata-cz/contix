CREATE TABLE "identity_report_schedules" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"reports" text[] DEFAULT '{summary}'::text[] NOT NULL,
	"format" varchar(10) DEFAULT 'docx' NOT NULL,
	"day" integer DEFAULT 1 NOT NULL,
	"group_by" varchar(20) DEFAULT 'department' NOT NULL,
	"last_sent_at" timestamp with time zone,
	"last_status" text,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity_report_schedules" ADD CONSTRAINT "identity_report_schedules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_report_schedules" ADD CONSTRAINT "identity_report_schedules_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;