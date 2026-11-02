CREATE TYPE "public"."risk_catalog_kind" AS ENUM('threat', 'weakness');--> statement-breakpoint
CREATE TYPE "public"."org_unit_type" AS ENUM('organization', 'division', 'department', 'section', 'team', 'other');--> statement-breakpoint
CREATE TYPE "public"."party_kind" AS ENUM('position', 'org_unit');--> statement-breakpoint
CREATE TYPE "public"."process_status" AS ENUM('draft', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."process_type" AS ENUM('management', 'core', 'support');--> statement-breakpoint
CREATE TYPE "public"."raci_role" AS ENUM('R', 'A', 'C', 'I');--> statement-breakpoint
CREATE TYPE "public"."risk_status" AS ENUM('identified', 'assessed', 'treatment', 'accepted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."step_type" AS ENUM('task', 'decision', 'subprocess', 'event');--> statement-breakpoint
CREATE TYPE "public"."risk_treatment" AS ENUM('mitigate', 'accept', 'transfer', 'avoid');--> statement-breakpoint
CREATE TABLE "org_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"name" varchar(255) NOT NULL,
	"code" varchar(50),
	"unit_type" "org_unit_type" DEFAULT 'department' NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "position_holders" (
	"position_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"since" date,
	CONSTRAINT "position_holders_position_id_user_id_pk" PRIMARY KEY("position_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_unit_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"code" varchar(50),
	"description" text,
	"is_manager" boolean DEFAULT false NOT NULL,
	"security_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"process_id" uuid NOT NULL,
	"step_id" uuid,
	"asset_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"process_id" uuid NOT NULL,
	"step_id" uuid,
	"title" varchar(500) NOT NULL,
	"url" text,
	"doc_type" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "process_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"process_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"name" varchar(255) NOT NULL,
	"step_type" "step_type" DEFAULT 'task' NOT NULL,
	"description" text,
	"inputs" text,
	"outputs" text,
	"duration" varchar(255),
	"systems" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"code" varchar(50),
	"name" varchar(255) NOT NULL,
	"process_type" "process_type" DEFAULT 'core' NOT NULL,
	"status" "process_status" DEFAULT 'draft' NOT NULL,
	"purpose" text,
	"description" text,
	"trigger" text,
	"inputs" text,
	"outputs" text,
	"kpis" text,
	"frequency" varchar(255),
	"legislation" text,
	"owner_position_id" uuid,
	"org_unit_id" uuid,
	"criticality" "criticality" DEFAULT 'medium' NOT NULL,
	"bpmn_xml" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_assets" (
	"risk_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "risk_assets_risk_id_asset_id_pk" PRIMARY KEY("risk_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "risk_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "risk_catalog_kind" NOT NULL,
	"code" varchar(50),
	"name" varchar(500) NOT NULL,
	"category" varchar(200),
	"description" text,
	"affects_c" boolean DEFAULT true NOT NULL,
	"affects_i" boolean DEFAULT true NOT NULL,
	"affects_a" boolean DEFAULT true NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_cves" (
	"risk_id" uuid NOT NULL,
	"vulnerability_id" uuid NOT NULL,
	CONSTRAINT "risk_cves_risk_id_vulnerability_id_pk" PRIMARY KEY("risk_id","vulnerability_id")
);
--> statement-breakpoint
CREATE TABLE "risk_processes" (
	"risk_id" uuid NOT NULL,
	"process_id" uuid NOT NULL,
	CONSTRAINT "risk_processes_risk_id_process_id_pk" PRIMARY KEY("risk_id","process_id")
);
--> statement-breakpoint
CREATE TABLE "risks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50),
	"name" varchar(500) NOT NULL,
	"description" text,
	"threat_id" uuid,
	"weakness_id" uuid,
	"owner_position_id" uuid,
	"status" "risk_status" DEFAULT 'identified' NOT NULL,
	"impact" smallint,
	"threat_level" smallint,
	"vuln_level" smallint,
	"likelihood" smallint,
	"treatment" "risk_treatment",
	"treatment_plan" text,
	"treatment_due" date,
	"residual_impact" smallint,
	"residual_threat_level" smallint,
	"residual_vuln_level" smallint,
	"residual_likelihood" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "step_raci" (
	"step_id" uuid NOT NULL,
	"party_kind" "party_kind" NOT NULL,
	"party_id" uuid NOT NULL,
	"role" "raci_role" NOT NULL,
	CONSTRAINT "step_raci_step_id_party_kind_party_id_role_pk" PRIMARY KEY("step_id","party_kind","party_id","role")
);
--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_parent_id_org_units_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."org_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_holders" ADD CONSTRAINT "position_holders_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_holders" ADD CONSTRAINT "position_holders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_assets" ADD CONSTRAINT "process_assets_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_assets" ADD CONSTRAINT "process_assets_step_id_process_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."process_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_assets" ADD CONSTRAINT "process_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_documents" ADD CONSTRAINT "process_documents_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_documents" ADD CONSTRAINT "process_documents_step_id_process_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."process_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_steps" ADD CONSTRAINT "process_steps_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processes" ADD CONSTRAINT "processes_parent_id_processes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."processes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processes" ADD CONSTRAINT "processes_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processes" ADD CONSTRAINT "processes_org_unit_id_org_units_id_fk" FOREIGN KEY ("org_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assets" ADD CONSTRAINT "risk_assets_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assets" ADD CONSTRAINT "risk_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_cves" ADD CONSTRAINT "risk_cves_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_cves" ADD CONSTRAINT "risk_cves_vulnerability_id_asset_vulnerabilities_id_fk" FOREIGN KEY ("vulnerability_id") REFERENCES "public"."asset_vulnerabilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_processes" ADD CONSTRAINT "risk_processes_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_processes" ADD CONSTRAINT "risk_processes_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_threat_id_risk_catalog_id_fk" FOREIGN KEY ("threat_id") REFERENCES "public"."risk_catalog"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_weakness_id_risk_catalog_id_fk" FOREIGN KEY ("weakness_id") REFERENCES "public"."risk_catalog"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "step_raci" ADD CONSTRAINT "step_raci_step_id_process_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."process_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_units_parent_idx" ON "org_units" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "positions_unit_idx" ON "positions" USING btree ("org_unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "process_assets_uq" ON "process_assets" USING btree ("process_id","asset_id",coalesce("step_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "process_assets_asset_idx" ON "process_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "process_steps_process_idx" ON "process_steps" USING btree ("process_id","order");--> statement-breakpoint
CREATE INDEX "processes_parent_idx" ON "processes" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "risk_assets_asset_idx" ON "risk_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_catalog_code_uq" ON "risk_catalog" USING btree ("kind","code");--> statement-breakpoint
CREATE INDEX "risk_processes_process_idx" ON "risk_processes" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX "risks_status_idx" ON "risks" USING btree ("status");