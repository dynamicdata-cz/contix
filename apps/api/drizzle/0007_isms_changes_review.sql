CREATE TYPE "public"."change_decision" AS ENUM('not_assessed', 'not_needed', 'planned', 'done');--> statement-breakpoint
CREATE TYPE "public"."change_status" AS ENUM('proposed', 'assessed', 'approved', 'implemented', 'closed', 'rejected', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."change_type" AS ENUM('technical', 'application', 'network', 'organizational', 'process', 'supplier', 'scope', 'other');--> statement-breakpoint
CREATE TYPE "public"."objective_status" AS ENUM('not_evaluated', 'met', 'partially_met', 'not_met', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."doc_kind" ADD VALUE 'isms_review';--> statement-breakpoint
CREATE TABLE "change_assets" (
	"change_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "change_assets_change_id_asset_id_pk" PRIMARY KEY("change_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "change_controls" (
	"change_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	CONSTRAINT "change_controls_change_id_control_id_pk" PRIMARY KEY("change_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "change_processes" (
	"change_id" uuid NOT NULL,
	"process_id" uuid NOT NULL,
	CONSTRAINT "change_processes_change_id_process_id_pk" PRIMARY KEY("change_id","process_id")
);
--> statement-breakpoint
CREATE TABLE "change_risks" (
	"change_id" uuid NOT NULL,
	"risk_id" uuid NOT NULL,
	CONSTRAINT "change_risks_change_id_risk_id_pk" PRIMARY KEY("change_id","risk_id")
);
--> statement-breakpoint
CREATE TABLE "change_suppliers" (
	"change_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	CONSTRAINT "change_suppliers_change_id_supplier_id_pk" PRIMARY KEY("change_id","supplier_id")
);
--> statement-breakpoint
CREATE TABLE "changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50),
	"title" varchar(300) NOT NULL,
	"description" text,
	"change_type" "change_type" DEFAULT 'technical' NOT NULL,
	"status" "change_status" DEFAULT 'proposed' NOT NULL,
	"owner_position_id" uuid,
	"requested_by" varchar(200),
	"planned_at" date,
	"implemented_at" date,
	"affects_security" boolean DEFAULT false NOT NULL,
	"significant" boolean DEFAULT false NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"significance_reason" text,
	"risk_assessment" text,
	"measures" text,
	"docs_updated_at" date,
	"docs_note" text,
	"tested_at" date,
	"test_result" text,
	"rollback_plan" text,
	"pentest" "change_decision" DEFAULT 'not_assessed' NOT NULL,
	"pentest_note" text,
	"audit" "change_decision" DEFAULT 'not_assessed' NOT NULL,
	"audit_note" text,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "isms_objectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50),
	"title" varchar(300) NOT NULL,
	"description" text,
	"metric" varchar(500),
	"target" varchar(200),
	"current_value" varchar(200),
	"status" "objective_status" DEFAULT 'not_evaluated' NOT NULL,
	"evaluation" text,
	"evaluated_at" date,
	"due_date" date,
	"owner_position_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "change_assets" ADD CONSTRAINT "change_assets_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_assets" ADD CONSTRAINT "change_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_controls" ADD CONSTRAINT "change_controls_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_processes" ADD CONSTRAINT "change_processes_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_processes" ADD CONSTRAINT "change_processes_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_risks" ADD CONSTRAINT "change_risks_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_risks" ADD CONSTRAINT "change_risks_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_suppliers" ADD CONSTRAINT "change_suppliers_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_suppliers" ADD CONSTRAINT "change_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "isms_objectives" ADD CONSTRAINT "isms_objectives_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "changes_status_idx" ON "changes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "changes_significant_idx" ON "changes" USING btree ("significant");