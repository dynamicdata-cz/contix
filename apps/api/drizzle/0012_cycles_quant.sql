CREATE TYPE "public"."cycle_item_state" AS ENUM('pending', 'reassessed', 'confirmed', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."cycle_kind" AS ENUM('risk', 'bia');--> statement-breakpoint
CREATE TYPE "public"."cycle_reason" AS ENUM('regular', 'significant_change', 'incident', 'audit', 'other');--> statement-breakpoint
CREATE TYPE "public"."cycle_status" AS ENUM('in_progress', 'review', 'approved', 'cancelled');--> statement-breakpoint
CREATE TABLE "assessment_cycle_items" (
	"cycle_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"code" varchar(50),
	"state" "cycle_item_state" DEFAULT 'pending' NOT NULL,
	"note" text,
	"before" jsonb,
	"after" jsonb,
	"decided_at" timestamp with time zone,
	"decided_by_id" uuid,
	CONSTRAINT "assessment_cycle_items_cycle_id_entity_id_pk" PRIMARY KEY("cycle_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "assessment_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"kind" "cycle_kind" NOT NULL,
	"title" varchar(300) NOT NULL,
	"reason" "cycle_reason" DEFAULT 'regular' NOT NULL,
	"status" "cycle_status" DEFAULT 'in_progress' NOT NULL,
	"change_id" uuid,
	"period_from" date,
	"period_to" date,
	"due_date" date,
	"leader_position_id" uuid,
	"team" text,
	"scope" text,
	"methodology_key" varchar(40),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by_id" uuid,
	"approval_note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "quant" jsonb;--> statement-breakpoint
ALTER TABLE "assessment_cycle_items" ADD CONSTRAINT "assessment_cycle_items_cycle_id_assessment_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."assessment_cycles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_cycle_items" ADD CONSTRAINT "assessment_cycle_items_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_cycles" ADD CONSTRAINT "assessment_cycles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_cycles" ADD CONSTRAINT "assessment_cycles_change_id_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."changes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_cycles" ADD CONSTRAINT "assessment_cycles_leader_position_id_positions_id_fk" FOREIGN KEY ("leader_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_cycles" ADD CONSTRAINT "assessment_cycles_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_cycles" ADD CONSTRAINT "assessment_cycles_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessment_cycles_company_idx" ON "assessment_cycles" USING btree ("company_id","kind");