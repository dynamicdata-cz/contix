ALTER TYPE "public"."policy_version_status" ADD VALUE 'review' BEFORE 'approved';--> statement-breakpoint
ALTER TYPE "public"."policy_version_status" ADD VALUE 'approval' BEFORE 'approved';--> statement-breakpoint
CREATE TABLE "policy_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"version_id" uuid,
	"user_id" uuid,
	"reference" varchar(200),
	"text" text NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"response" text,
	"responded_by_id" uuid,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"action" varchar(30) NOT NULL,
	"from_status" varchar(20) NOT NULL,
	"to_status" varchar(20) NOT NULL,
	"note" text,
	"user_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"mime" varchar(150) NOT NULL,
	"size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" "bytea" NOT NULL,
	"uploaded_by_id" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_quiz_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"score" smallint NOT NULL,
	"passed" boolean NOT NULL,
	"answers" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_quiz_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"question" text NOT NULL,
	"options" text[] NOT NULL,
	"correct" integer[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "reviewer_position_id" uuid;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "approver_position_id" uuid;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "ack_due_days" smallint DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "retrain_on_new_version" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "quiz_pass_pct" smallint DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "policy_comments" ADD CONSTRAINT "policy_comments_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_comments" ADD CONSTRAINT "policy_comments_version_id_policy_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."policy_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_comments" ADD CONSTRAINT "policy_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_comments" ADD CONSTRAINT "policy_comments_responded_by_id_users_id_fk" FOREIGN KEY ("responded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_events" ADD CONSTRAINT "policy_events_version_id_policy_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."policy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_events" ADD CONSTRAINT "policy_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_files" ADD CONSTRAINT "policy_files_version_id_policy_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."policy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_files" ADD CONSTRAINT "policy_files_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_quiz_attempts" ADD CONSTRAINT "policy_quiz_attempts_version_id_policy_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."policy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_quiz_attempts" ADD CONSTRAINT "policy_quiz_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_quiz_questions" ADD CONSTRAINT "policy_quiz_questions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policy_comments_policy_idx" ON "policy_comments" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "policy_events_version_idx" ON "policy_events" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "policy_files_version_idx" ON "policy_files" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "policy_quiz_attempts_idx" ON "policy_quiz_attempts" USING btree ("version_id","user_id");--> statement-breakpoint
CREATE INDEX "policy_quiz_policy_idx" ON "policy_quiz_questions" USING btree ("policy_id");--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_reviewer_position_id_positions_id_fk" FOREIGN KEY ("reviewer_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_approver_position_id_positions_id_fk" FOREIGN KEY ("approver_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;