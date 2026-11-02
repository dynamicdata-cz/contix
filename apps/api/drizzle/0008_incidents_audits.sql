CREATE TYPE "public"."audit_status" AS ENUM('planned', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."audit_type" AS ENUM('regular', 'partial', 'change', 'supplier', 'check', 'authority');--> statement-breakpoint
CREATE TYPE "public"."authority_decision" AS ENUM('pending', 'significant', 'not_significant');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('major', 'minor', 'observation', 'recommendation');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('open', 'in_progress', 'closed', 'accepted');--> statement-breakpoint
CREATE TYPE "public"."incident_category" AS ENUM('malware', 'ransomware', 'phishing', 'unauthorized_access', 'account_compromise', 'dos', 'data_leak', 'vulnerability_exploit', 'misconfiguration', 'hw_failure', 'physical', 'supplier', 'other');--> statement-breakpoint
CREATE TYPE "public"."incident_cause" AS ENUM('unknown', 'human_error', 'technical_failure', 'intentional');--> statement-breakpoint
CREATE TYPE "public"."incident_kind" AS ENUM('unassessed', 'event', 'incident');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('new', 'assessing', 'handling', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."incident_report_channel" AS ENUM('portal', 'email', 'data_box', 'other');--> statement-breakpoint
CREATE TYPE "public"."incident_report_recipient" AS ENUM('nukib', 'national_cert', 'uoou', 'other');--> statement-breakpoint
CREATE TYPE "public"."incident_report_type" AS ENUM('initial', 'notification', 'interim', 'final', 'voluntary', 'gdpr');--> statement-breakpoint
CREATE TABLE "audit_changes" (
	"audit_id" uuid NOT NULL,
	"change_id" uuid NOT NULL,
	CONSTRAINT "audit_changes_audit_id_change_id_pk" PRIMARY KEY("audit_id","change_id")
);
--> statement-breakpoint
CREATE TABLE "audit_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"code" varchar(50),
	"title" varchar(500) NOT NULL,
	"description" text,
	"severity" "finding_severity" DEFAULT 'minor' NOT NULL,
	"status" "finding_status" DEFAULT 'open' NOT NULL,
	"requirement_id" varchar(100),
	"corrective_action" text,
	"owner_position_id" uuid,
	"due_date" date,
	"closed_at" date,
	"verification" text,
	"risk_id" uuid,
	"awareness" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50),
	"title" varchar(300) NOT NULL,
	"audit_type" "audit_type" DEFAULT 'regular' NOT NULL,
	"status" "audit_status" DEFAULT 'planned' NOT NULL,
	"sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope" text,
	"planned_start" date,
	"planned_end" date,
	"performed_start" date,
	"performed_end" date,
	"auditor_name" varchar(200),
	"auditor_position_id" uuid,
	"auditor_external" boolean DEFAULT false NOT NULL,
	"auditor_qualified" boolean DEFAULT false NOT NULL,
	"auditor_independent" boolean DEFAULT false NOT NULL,
	"conclusion" text,
	"report_ref" varchar(300),
	"management_informed_at" date,
	"supplier_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_assets" (
	"incident_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "incident_assets_incident_id_asset_id_pk" PRIMARY KEY("incident_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "incident_controls" (
	"incident_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	CONSTRAINT "incident_controls_incident_id_control_id_pk" PRIMARY KEY("incident_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "incident_processes" (
	"incident_id" uuid NOT NULL,
	"process_id" uuid NOT NULL,
	CONSTRAINT "incident_processes_incident_id_process_id_pk" PRIMARY KEY("incident_id","process_id")
);
--> statement-breakpoint
CREATE TABLE "incident_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"report_type" "incident_report_type" NOT NULL,
	"recipient" "incident_report_recipient" DEFAULT 'nukib' NOT NULL,
	"channel" "incident_report_channel" DEFAULT 'portal' NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"reference" varchar(200),
	"summary" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_risks" (
	"incident_id" uuid NOT NULL,
	"risk_id" uuid NOT NULL,
	CONSTRAINT "incident_risks_incident_id_risk_id_pk" PRIMARY KEY("incident_id","risk_id")
);
--> statement-breakpoint
CREATE TABLE "incident_suppliers" (
	"incident_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	CONSTRAINT "incident_suppliers_incident_id_supplier_id_pk" PRIMARY KEY("incident_id","supplier_id")
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50),
	"title" varchar(300) NOT NULL,
	"description" text,
	"kind" "incident_kind" DEFAULT 'unassessed' NOT NULL,
	"status" "incident_status" DEFAULT 'new' NOT NULL,
	"category" "incident_category" DEFAULT 'other' NOT NULL,
	"cause" "incident_cause" DEFAULT 'unknown' NOT NULL,
	"reported_by" varchar(200),
	"owner_position_id" uuid,
	"detected_at" timestamp with time zone NOT NULL,
	"occurred_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"in_scope" boolean DEFAULT true NOT NULL,
	"cyber_origin" boolean DEFAULT true NOT NULL,
	"intent_excluded" boolean DEFAULT false NOT NULL,
	"tolerance_exceeded" boolean DEFAULT false NOT NULL,
	"significance_areas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"significance_note" text,
	"authority_decision" "authority_decision" DEFAULT 'pending' NOT NULL,
	"suspected_unlawful" boolean DEFAULT false NOT NULL,
	"cross_border" boolean DEFAULT false NOT NULL,
	"personal_data_breach" boolean DEFAULT false NOT NULL,
	"affected_users" integer,
	"downtime_hours" real,
	"financial_loss" real,
	"impact_description" text,
	"indicators" text,
	"evidence" text,
	"containment" text,
	"root_cause" text,
	"lessons_learned" text,
	"timeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_changes" ADD CONSTRAINT "audit_changes_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_changes" ADD CONSTRAINT "audit_changes_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_auditor_position_id_positions_id_fk" FOREIGN KEY ("auditor_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_assets" ADD CONSTRAINT "incident_assets_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_assets" ADD CONSTRAINT "incident_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_controls" ADD CONSTRAINT "incident_controls_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_controls" ADD CONSTRAINT "incident_controls_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_processes" ADD CONSTRAINT "incident_processes_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_processes" ADD CONSTRAINT "incident_processes_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_risks" ADD CONSTRAINT "incident_risks_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_risks" ADD CONSTRAINT "incident_risks_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_suppliers" ADD CONSTRAINT "incident_suppliers_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_suppliers" ADD CONSTRAINT "incident_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incidents_detected_idx" ON "incidents" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "incidents" USING btree ("status");