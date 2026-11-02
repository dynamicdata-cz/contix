CREATE TYPE "public"."audit_check_result" AS ENUM('not_checked', 'conform', 'partial', 'nonconform', 'not_applicable');--> statement-breakpoint
CREATE TABLE "audit_checks" (
	"audit_id" uuid NOT NULL,
	"item_id" varchar(60) NOT NULL,
	"result" "audit_check_result" DEFAULT 'not_checked' NOT NULL,
	"note" text,
	"finding_id" uuid,
	"checked_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_checks_audit_id_item_id_pk" PRIMARY KEY("audit_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "methodologies" (
	"id" varchar(40) PRIMARY KEY NOT NULL,
	"kind" varchar(10) NOT NULL,
	"name" varchar(200) NOT NULL,
	"version" varchar(50) DEFAULT '1.0' NOT NULL,
	"format" varchar(10) NOT NULL,
	"source" text NOT NULL,
	"definition" jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "methodology_key" varchar(40);--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "methodology_key" varchar(40) DEFAULT 'zkb409' NOT NULL;--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "factor_values" jsonb;--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "residual_factor_values" jsonb;--> statement-breakpoint
ALTER TABLE "audit_checks" ADD CONSTRAINT "audit_checks_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_checks" ADD CONSTRAINT "audit_checks_finding_id_audit_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."audit_findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_checks" ADD CONSTRAINT "audit_checks_checked_by_id_users_id_fk" FOREIGN KEY ("checked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "methodologies" ADD CONSTRAINT "methodologies_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;