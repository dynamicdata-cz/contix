CREATE TYPE "public"."control_test_result" AS ENUM('effective', 'effective_with_exceptions', 'ineffective', 'not_tested');--> statement-breakpoint
CREATE TYPE "public"."evidence_kind" AS ENUM('document', 'record', 'screenshot', 'export', 'config', 'report', 'link', 'other');--> statement-breakpoint
CREATE TYPE "public"."control_sample_result" AS ENUM('pass', 'fail', 'na');--> statement-breakpoint
CREATE TYPE "public"."control_test_kind" AS ENUM('design', 'operating');--> statement-breakpoint
CREATE TYPE "public"."control_test_status" AS ENUM('planned', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "control_test_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" uuid NOT NULL,
	"ref" varchar(200) NOT NULL,
	"description" text,
	"result" "control_sample_result" DEFAULT 'pass' NOT NULL,
	"note" text,
	"evidence_id" uuid,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"control_id" uuid NOT NULL,
	"kind" "control_test_kind" DEFAULT 'operating' NOT NULL,
	"title" varchar(300),
	"methods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"frequency" varchar(20),
	"period_from" date,
	"period_to" date,
	"due_date" date,
	"status" "control_test_status" DEFAULT 'planned' NOT NULL,
	"tester" varchar(200),
	"population_size" integer,
	"procedure" text,
	"tolerable_exceptions" integer DEFAULT 0 NOT NULL,
	"result" "control_test_result",
	"conclusion" text,
	"performed_at" date,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"title" varchar(300) NOT NULL,
	"description" text,
	"kind" "evidence_kind" DEFAULT 'document' NOT NULL,
	"url" varchar(2000),
	"collected_at" date,
	"period_from" date,
	"period_to" date,
	"valid_until" date,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_controls" (
	"evidence_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	CONSTRAINT "evidence_controls_evidence_id_control_id_pk" PRIMARY KEY("evidence_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "evidence_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evidence_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"mime" varchar(150) NOT NULL,
	"size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" "bytea" NOT NULL,
	"uploaded_by_id" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "control_test_samples" ADD CONSTRAINT "control_test_samples_test_id_control_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."control_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_test_samples" ADD CONSTRAINT "control_test_samples_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_tests" ADD CONSTRAINT "control_tests_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_controls" ADD CONSTRAINT "evidence_controls_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_controls" ADD CONSTRAINT "evidence_controls_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_files" ADD CONSTRAINT "evidence_files_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "control_test_samples_test_idx" ON "control_test_samples" USING btree ("test_id");--> statement-breakpoint
CREATE INDEX "control_tests_ctl_idx" ON "control_tests" USING btree ("control_id");--> statement-breakpoint
CREATE INDEX "control_tests_due_idx" ON "control_tests" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "evidence_company_idx" ON "evidence" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "evidence_valid_idx" ON "evidence" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "evidence_controls_ctl_idx" ON "evidence_controls" USING btree ("control_id");--> statement-breakpoint
CREATE INDEX "evidence_files_ev_idx" ON "evidence_files" USING btree ("evidence_id");