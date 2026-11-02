CREATE TYPE "public"."treatment_action_status" AS ENUM('planned', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."bia_status" AS ENUM('draft', 'approved');--> statement-breakpoint
CREATE TYPE "public"."compliance_level" AS ENUM('not_assessed', 'compliant', 'partial', 'non_compliant', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."control_category" AS ENUM('organizational', 'technical', 'physical', 'people');--> statement-breakpoint
CREATE TYPE "public"."control_status" AS ENUM('not_implemented', 'planned', 'in_progress', 'implemented', 'not_applicable');--> statement-breakpoint
CREATE TYPE "public"."control_effectiveness" AS ENUM('not_assessed', 'effective', 'partially_effective', 'ineffective');--> statement-breakpoint
CREATE TABLE "bia_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"process_id" uuid NOT NULL,
	"status" "bia_status" DEFAULT 'draft' NOT NULL,
	"assessed_at" date,
	"impacts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mtpd_hours" real,
	"rto_hours" real,
	"rpo_hours" real,
	"min_service_level" text,
	"peak_periods" text,
	"dependencies" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_assets" (
	"control_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "control_assets_control_id_asset_id_pk" PRIMARY KEY("control_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "control_requirements" (
	"control_id" uuid NOT NULL,
	"requirement_id" varchar(100) NOT NULL,
	CONSTRAINT "control_requirements_control_id_requirement_id_pk" PRIMARY KEY("control_id","requirement_id")
);
--> statement-breakpoint
CREATE TABLE "controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50),
	"name" varchar(500) NOT NULL,
	"description" text,
	"category" "control_category" DEFAULT 'organizational' NOT NULL,
	"owner_position_id" uuid,
	"status" "control_status" DEFAULT 'not_implemented' NOT NULL,
	"implementation" text,
	"evidence" text,
	"effectiveness" "control_effectiveness" DEFAULT 'not_assessed' NOT NULL,
	"planned_date" date,
	"priority" smallint,
	"last_review_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_assessments" (
	"requirement_id" varchar(100) PRIMARY KEY NOT NULL,
	"applicable" boolean DEFAULT true NOT NULL,
	"justification" text,
	"compensating" text,
	"compliance" "compliance_level",
	"implementation_note" text,
	"priority" smallint,
	"due_date" date,
	"owner_position_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_controls" (
	"risk_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	CONSTRAINT "risk_controls_risk_id_control_id_pk" PRIMARY KEY("risk_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "risk_treatment_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"risk_id" uuid NOT NULL,
	"control_id" uuid,
	"title" varchar(500) NOT NULL,
	"description" text,
	"objective" text,
	"owner_position_id" uuid,
	"resources_human" text,
	"resources_financial" text,
	"resources_technical" text,
	"cost_estimate" real,
	"due_date" date,
	"realization" text,
	"status" "treatment_action_status" DEFAULT 'planned' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "risks" ALTER COLUMN "treatment" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."risk_treatment";--> statement-breakpoint
CREATE TYPE "public"."risk_treatment" AS ENUM('mitigate', 'accept', 'eliminate', 'avoid', 'transfer');--> statement-breakpoint
ALTER TABLE "risks" ALTER COLUMN "treatment" SET DATA TYPE "public"."risk_treatment" USING "treatment"::"public"."risk_treatment";--> statement-breakpoint
ALTER TABLE "risk_catalog" ADD COLUMN "source" varchar(200);--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "scale_levels" smallint DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "assessed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bia_assessments" ADD CONSTRAINT "bia_assessments_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_assets" ADD CONSTRAINT "control_assets_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_assets" ADD CONSTRAINT "control_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_requirements" ADD CONSTRAINT "control_requirements_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_assessments" ADD CONSTRAINT "requirement_assessments_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_assessments" ADD CONSTRAINT "requirement_assessments_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_controls" ADD CONSTRAINT "risk_controls_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_controls" ADD CONSTRAINT "risk_controls_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_treatment_actions" ADD CONSTRAINT "risk_treatment_actions_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_treatment_actions" ADD CONSTRAINT "risk_treatment_actions_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_treatment_actions" ADD CONSTRAINT "risk_treatment_actions_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bia_process_uq" ON "bia_assessments" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX "control_req_req_idx" ON "control_requirements" USING btree ("requirement_id");--> statement-breakpoint
CREATE INDEX "controls_status_idx" ON "controls" USING btree ("status");--> statement-breakpoint
CREATE INDEX "risk_controls_control_idx" ON "risk_controls" USING btree ("control_id");--> statement-breakpoint
CREATE INDEX "rta_risk_idx" ON "risk_treatment_actions" USING btree ("risk_id");--> statement-breakpoint
CREATE INDEX "rta_due_idx" ON "risk_treatment_actions" USING btree ("due_date");