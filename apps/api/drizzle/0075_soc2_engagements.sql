ALTER TYPE "public"."audit_type" ADD VALUE 'soc2';--> statement-breakpoint
CREATE TABLE "soc2_engagements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"audit_id" uuid NOT NULL,
	"report_type" varchar(10) DEFAULT 'type2' NOT NULL,
	"categories" text[] DEFAULT '{CC}'::text[] NOT NULL,
	"as_of" date,
	"period_from" date,
	"period_to" date,
	"system_name" varchar(300) DEFAULT '' NOT NULL,
	"service_org" varchar(300),
	"service_auditor" varchar(300),
	"signatory" varchar(200),
	"report_date" date,
	"report_place" varchar(100),
	"opinion" varchar(20) DEFAULT 'unmodified' NOT NULL,
	"opinion_basis" text,
	"assertion" text,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cuecs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subservice" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"workpapers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"other_info" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "soc2_engagements_audit_id_unique" UNIQUE("audit_id")
);
--> statement-breakpoint
ALTER TABLE "audit_findings" ADD COLUMN "control_test_id" uuid;--> statement-breakpoint
ALTER TABLE "soc2_engagements" ADD CONSTRAINT "soc2_engagements_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc2_engagements" ADD CONSTRAINT "soc2_engagements_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "soc2_engagements_company_idx" ON "soc2_engagements" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_control_test_id_control_tests_id_fk" FOREIGN KEY ("control_test_id") REFERENCES "public"."control_tests"("id") ON DELETE set null ON UPDATE no action;