CREATE TYPE "public"."classification" AS ENUM('public', 'internal', 'confidential', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."course_form" AS ENUM('classroom', 'elearning', 'webinar', 'document', 'exercise', 'external');--> statement-breakpoint
CREATE TYPE "public"."course_kind" AS ENUM('induction', 'periodic', 'management', 'professional', 'verification');--> statement-breakpoint
CREATE TYPE "public"."policy_status" AS ENUM('draft', 'active', 'retired');--> statement-breakpoint
CREATE TYPE "public"."policy_type" AS ENUM('policy', 'directive', 'procedure', 'standard', 'plan', 'guideline', 'record');--> statement-breakpoint
CREATE TYPE "public"."policy_version_status" AS ENUM('draft', 'approved', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."training_session_status" AS ENUM('planned', 'held', 'cancelled');--> statement-breakpoint
CREATE TABLE "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(200) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"recipient" varchar(320) NOT NULL,
	"urgency" varchar(20) NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean DEFAULT true NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"code" varchar(50),
	"title" varchar(300) NOT NULL,
	"doc_type" "policy_type" DEFAULT 'directive' NOT NULL,
	"status" "policy_status" DEFAULT 'draft' NOT NULL,
	"description" text,
	"sections" text[] DEFAULT '{}'::text[] NOT NULL,
	"owner_position_id" uuid,
	"review_months" smallint DEFAULT 12 NOT NULL,
	"classification" "classification" DEFAULT 'internal' NOT NULL,
	"location" text,
	"audience" jsonb DEFAULT '{"all":false,"unitIds":[],"positionIds":[],"securityRoles":[],"management":false}'::jsonb NOT NULL,
	"require_acknowledgement" boolean DEFAULT true NOT NULL,
	"last_reviewed_at" date,
	"last_review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_acknowledgements" (
	"version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_acknowledgements_version_id_user_id_pk" PRIMARY KEY("version_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "policy_controls" (
	"policy_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	CONSTRAINT "policy_controls_policy_id_control_id_pk" PRIMARY KEY("policy_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"version" varchar(20) NOT NULL,
	"status" "policy_version_status" DEFAULT 'draft' NOT NULL,
	"change_summary" text,
	"content" text,
	"effective_from" date,
	"created_by_id" uuid,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"code" varchar(50),
	"title" varchar(300) NOT NULL,
	"kind" "course_kind" DEFAULT 'periodic' NOT NULL,
	"form" "course_form" DEFAULT 'elearning' NOT NULL,
	"description" text,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"audience" jsonb DEFAULT '{"all":false,"unitIds":[],"positionIds":[],"securityRoles":[],"management":false}'::jsonb NOT NULL,
	"interval_months" smallint,
	"due_days_for_new" smallint,
	"duration_hours" real,
	"owner_position_id" uuid,
	"policy_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"session_id" uuid,
	"user_id" uuid NOT NULL,
	"completed_at" date NOT NULL,
	"score" real,
	"passed" boolean DEFAULT true NOT NULL,
	"note" text,
	"recorded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_session_participants" (
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "training_session_participants_session_id_user_id_pk" PRIMARY KEY("session_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "training_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "training_session_status" DEFAULT 'planned' NOT NULL,
	"trainer" varchar(200),
	"location" varchar(300),
	"note" text,
	"effectiveness" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_acknowledgements" ADD CONSTRAINT "policy_acknowledgements_version_id_policy_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."policy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_acknowledgements" ADD CONSTRAINT "policy_acknowledgements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_controls" ADD CONSTRAINT "policy_controls_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_controls" ADD CONSTRAINT "policy_controls_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_session_participants" ADD CONSTRAINT "training_session_participants_session_id_training_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."training_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_session_participants" ADD CONSTRAINT "training_session_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_log_uq" ON "notification_log" USING btree ("key","channel","recipient","urgency");--> statement-breakpoint
CREATE INDEX "policies_company_idx" ON "policies" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_versions_uq" ON "policy_versions" USING btree ("policy_id","version");--> statement-breakpoint
CREATE INDEX "training_courses_company_idx" ON "training_courses" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "training_records_course_user_idx" ON "training_records" USING btree ("course_id","user_id");