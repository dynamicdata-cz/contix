ALTER TYPE "public"."control_automation_kind" ADD VALUE 'sca';--> statement-breakpoint
CREATE TABLE "sca_check_defs" (
	"policy_id" varchar(100) NOT NULL,
	"check_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"rationale" text,
	"remediation" text,
	"compliance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sca_check_defs_policy_id_check_id_pk" PRIMARY KEY("policy_id","check_id")
);
--> statement-breakpoint
CREATE TABLE "sca_check_results" (
	"asset_id" uuid NOT NULL,
	"policy_id" varchar(100) NOT NULL,
	"check_id" integer NOT NULL,
	"result" varchar(20) NOT NULL,
	CONSTRAINT "sca_check_results_asset_id_policy_id_check_id_pk" PRIMARY KEY("asset_id","policy_id","check_id")
);
--> statement-breakpoint
CREATE TABLE "sca_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"asset_id" uuid NOT NULL,
	"agent_id" varchar(50) NOT NULL,
	"policy_id" varchar(100) NOT NULL,
	"policy_name" varchar(300) NOT NULL,
	"pass" integer DEFAULT 0 NOT NULL,
	"fail" integer DEFAULT 0 NOT NULL,
	"na" integer DEFAULT 0 NOT NULL,
	"score" integer,
	"scanned_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_automations" ADD COLUMN "sca_policies" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "control_automations" ADD COLUMN "sca_min_score" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "control_automations" ADD COLUMN "sca_warn_score" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "sca_check_results" ADD CONSTRAINT "sca_check_results_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sca_results" ADD CONSTRAINT "sca_results_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sca_results" ADD CONSTRAINT "sca_results_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sca_check_results_check_idx" ON "sca_check_results" USING btree ("policy_id","check_id","result");--> statement-breakpoint
CREATE UNIQUE INDEX "sca_results_asset_policy_uq" ON "sca_results" USING btree ("asset_id","policy_id");--> statement-breakpoint
CREATE INDEX "sca_results_company_idx" ON "sca_results" USING btree ("company_id");