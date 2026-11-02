CREATE TYPE "public"."doc_kind" AS ENUM('risk_report', 'soa', 'treatment_plan');--> statement-breakpoint
CREATE TYPE "public"."doc_status" AS ENUM('draft', 'approved', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('draft', 'approved', 'retired');--> statement-breakpoint
CREATE TYPE "public"."plan_type" AS ENUM('continuity', 'recovery', 'incident_response', 'crisis_communication');--> statement-breakpoint
CREATE TYPE "public"."plan_test_result" AS ENUM('passed', 'partial', 'failed');--> statement-breakpoint
CREATE TYPE "public"."plan_test_type" AS ENUM('tabletop', 'walkthrough', 'simulation', 'full');--> statement-breakpoint
CREATE TABLE "continuity_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50),
	"name" varchar(300) NOT NULL,
	"plan_type" "plan_type" DEFAULT 'continuity' NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"owner_position_id" uuid,
	"purpose" text,
	"scope" text,
	"activation" text,
	"strategy" text,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resources" text,
	"rto_target_hours" real,
	"test_interval_months" integer DEFAULT 12 NOT NULL,
	"last_review_at" date,
	"approved_at" timestamp with time zone,
	"approved_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_acknowledgements" (
	"version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_acknowledgements_version_id_user_id_pk" PRIMARY KEY("version_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "doc_kind" NOT NULL,
	"framework" varchar(20) DEFAULT '' NOT NULL,
	"version" integer NOT NULL,
	"title" varchar(300) NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"note" text,
	"snapshot" jsonb NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_id" uuid,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_assets" (
	"plan_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "plan_assets_plan_id_asset_id_pk" PRIMARY KEY("plan_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "plan_processes" (
	"plan_id" uuid NOT NULL,
	"process_id" uuid NOT NULL,
	CONSTRAINT "plan_processes_plan_id_process_id_pk" PRIMARY KEY("plan_id","process_id")
);
--> statement-breakpoint
CREATE TABLE "plan_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"tested_at" date NOT NULL,
	"test_type" "plan_test_type" NOT NULL,
	"scenario" text,
	"participants" text,
	"result" "plan_test_result" NOT NULL,
	"achieved_rto_hours" real,
	"findings" text,
	"improvements" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_assets" (
	"supplier_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "supplier_assets_supplier_id_asset_id_pk" PRIMARY KEY("supplier_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"title" varchar(300) NOT NULL,
	"number" varchar(100),
	"valid_from" date,
	"valid_to" date,
	"clause_set" varchar(10) DEFAULT 'cz409' NOT NULL,
	"clauses" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sla" text,
	"exit_strategy" text,
	"document_url" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_processes" (
	"supplier_id" uuid NOT NULL,
	"process_id" uuid NOT NULL,
	CONSTRAINT "supplier_processes_supplier_id_process_id_pk" PRIMARY KEY("supplier_id","process_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_risks" (
	"supplier_id" uuid NOT NULL,
	"risk_id" uuid NOT NULL,
	CONSTRAINT "supplier_risks_supplier_id_risk_id_pk" PRIMARY KEY("supplier_id","risk_id")
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(300) NOT NULL,
	"ico" varchar(20),
	"address" text,
	"country" varchar(100),
	"contact_name" varchar(200),
	"contact_email" varchar(200),
	"contact_phone" varchar(50),
	"supply_description" text,
	"significant" boolean DEFAULT false NOT NULL,
	"significance_reason" text,
	"data_outside_cz" boolean DEFAULT false NOT NULL,
	"rules_acknowledged_at" date,
	"notified_at" date,
	"notification_ref" varchar(200),
	"risk_assessed_at" date,
	"last_review_at" date,
	"review_interval_months" integer DEFAULT 12 NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "continuity_plans" ADD CONSTRAINT "continuity_plans_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "continuity_plans" ADD CONSTRAINT "continuity_plans_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_version_id_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acknowledgements" ADD CONSTRAINT "document_acknowledgements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_assets" ADD CONSTRAINT "plan_assets_plan_id_continuity_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."continuity_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_assets" ADD CONSTRAINT "plan_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_processes" ADD CONSTRAINT "plan_processes_plan_id_continuity_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."continuity_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_processes" ADD CONSTRAINT "plan_processes_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_tests" ADD CONSTRAINT "plan_tests_plan_id_continuity_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."continuity_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_tests" ADD CONSTRAINT "plan_tests_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_assets" ADD CONSTRAINT "supplier_assets_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_assets" ADD CONSTRAINT "supplier_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contracts" ADD CONSTRAINT "supplier_contracts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_processes" ADD CONSTRAINT "supplier_processes_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_processes" ADD CONSTRAINT "supplier_processes_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_risks" ADD CONSTRAINT "supplier_risks_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_risks" ADD CONSTRAINT "supplier_risks_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_uq" ON "document_versions" USING btree ("kind","framework","version");--> statement-breakpoint
CREATE INDEX "plan_tests_plan_idx" ON "plan_tests" USING btree ("plan_id","tested_at");