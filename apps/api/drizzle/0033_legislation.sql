CREATE TYPE "public"."legal_impact" AS ENUM('none', 'low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."legal_review_status" AS ENUM('new', 'in_review', 'assessed', 'closed');--> statement-breakpoint
CREATE TYPE "public"."legal_source" AS ENUM('esbirka', 'manual');--> statement-breakpoint
CREATE TYPE "public"."legal_task_status" AS ENUM('open', 'done', 'cancelled');--> statement-breakpoint
CREATE TABLE "legal_acts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid,
	"source" "legal_source" NOT NULL,
	"code" varchar(100) NOT NULL,
	"title" varchar(500) NOT NULL,
	"stale_url" varchar(200),
	"framework_id" varchar(20),
	"current_version_id" uuid,
	"last_checked_at" timestamp with time zone,
	"last_status" varchar(20),
	"last_error" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"act_id" uuid NOT NULL,
	"from_version_id" uuid,
	"to_version_id" uuid NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added" integer DEFAULT 0 NOT NULL,
	"removed" integer DEFAULT 0 NOT NULL,
	"modified" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_fragments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"key" varchar(200) NOT NULL,
	"label" varchar(500) NOT NULL,
	"text" text NOT NULL,
	"depth" smallint DEFAULT 0 NOT NULL,
	"kind" varchar(60) DEFAULT '' NOT NULL,
	"position" integer NOT NULL,
	"source_id" varchar(60)
);
--> statement-breakpoint
CREATE TABLE "legal_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"change_id" uuid NOT NULL,
	"status" "legal_review_status" DEFAULT 'new' NOT NULL,
	"impact" "legal_impact",
	"assessment" text,
	"ai_summary" text,
	"owner_position_id" uuid,
	"due_date" date,
	"assessed_by_id" uuid,
	"assessed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"review_id" uuid,
	"title" varchar(300) NOT NULL,
	"description" text,
	"owner_position_id" uuid,
	"due_date" date,
	"status" "legal_task_status" DEFAULT 'open' NOT NULL,
	"policy_id" uuid,
	"control_id" uuid,
	"requirement_id" varchar(100),
	"created_by_id" uuid,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"act_id" uuid NOT NULL,
	"version_key" varchar(200) NOT NULL,
	"effective_from" date,
	"source_url" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"fragment_count" integer DEFAULT 0 NOT NULL,
	"schema_version" smallint DEFAULT 1 NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "legal_watch" (
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"act_id" uuid NOT NULL,
	"owner_position_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_watch_company_id_act_id_pk" PRIMARY KEY("company_id","act_id")
);
--> statement-breakpoint
ALTER TABLE "legal_acts" ADD CONSTRAINT "legal_acts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_changes" ADD CONSTRAINT "legal_changes_act_id_legal_acts_id_fk" FOREIGN KEY ("act_id") REFERENCES "public"."legal_acts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_changes" ADD CONSTRAINT "legal_changes_from_version_id_legal_versions_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "public"."legal_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_changes" ADD CONSTRAINT "legal_changes_to_version_id_legal_versions_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "public"."legal_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_fragments" ADD CONSTRAINT "legal_fragments_version_id_legal_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."legal_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_reviews" ADD CONSTRAINT "legal_reviews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_reviews" ADD CONSTRAINT "legal_reviews_change_id_legal_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."legal_changes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_reviews" ADD CONSTRAINT "legal_reviews_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_reviews" ADD CONSTRAINT "legal_reviews_assessed_by_id_users_id_fk" FOREIGN KEY ("assessed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_tasks" ADD CONSTRAINT "legal_tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_tasks" ADD CONSTRAINT "legal_tasks_review_id_legal_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."legal_reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_tasks" ADD CONSTRAINT "legal_tasks_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_tasks" ADD CONSTRAINT "legal_tasks_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_tasks" ADD CONSTRAINT "legal_tasks_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_tasks" ADD CONSTRAINT "legal_tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_versions" ADD CONSTRAINT "legal_versions_act_id_legal_acts_id_fk" FOREIGN KEY ("act_id") REFERENCES "public"."legal_acts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_watch" ADD CONSTRAINT "legal_watch_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_watch" ADD CONSTRAINT "legal_watch_act_id_legal_acts_id_fk" FOREIGN KEY ("act_id") REFERENCES "public"."legal_acts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_watch" ADD CONSTRAINT "legal_watch_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_acts_stale_uq" ON "legal_acts" USING btree ("stale_url");--> statement-breakpoint
CREATE INDEX "legal_acts_company_idx" ON "legal_acts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "legal_changes_act_idx" ON "legal_changes" USING btree ("act_id");--> statement-breakpoint
CREATE INDEX "legal_fragments_version_idx" ON "legal_fragments" USING btree ("version_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_reviews_uq" ON "legal_reviews" USING btree ("company_id","change_id");--> statement-breakpoint
CREATE INDEX "legal_tasks_company_idx" ON "legal_tasks" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "legal_tasks_review_idx" ON "legal_tasks" USING btree ("review_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_versions_uq" ON "legal_versions" USING btree ("act_id","version_key","content_hash");--> statement-breakpoint
CREATE INDEX "legal_versions_act_idx" ON "legal_versions" USING btree ("act_id");