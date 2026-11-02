CREATE TYPE "public"."access_review_decision" AS ENUM('pending', 'keep', 'revoke');--> statement-breakpoint
CREATE TYPE "public"."access_review_status" AS ENUM('active', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."access_reviewer_mode" AS ENUM('position', 'manager');--> statement-breakpoint
CREATE TABLE "access_review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"account_id" uuid,
	"login" varchar(300) NOT NULL,
	"display_name" varchar(300) DEFAULT '' NOT NULL,
	"source_name" varchar(200) DEFAULT '' NOT NULL,
	"kind" "identity_account_kind" DEFAULT 'user' NOT NULL,
	"access" text[] DEFAULT '{}'::text[] NOT NULL,
	"privileged_via" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_logon_at" timestamp with time zone,
	"reviewer_position_id" uuid,
	"decision" "access_review_decision" DEFAULT 'pending' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"remediated_at" timestamp with time zone,
	"remediated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "access_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "access_review_status" DEFAULT 'active' NOT NULL,
	"scope" jsonb NOT NULL,
	"reviewer_mode" "access_reviewer_mode" DEFAULT 'position' NOT NULL,
	"reviewer_position_id" uuid,
	"due_date" date NOT NULL,
	"created_by" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sod_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"severity" "identity_severity" DEFAULT 'high' NOT NULL,
	"side_a" jsonb NOT NULL,
	"side_b" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sod_violations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"subject" varchar(100) NOT NULL,
	"user_id" uuid,
	"person" varchar(300) DEFAULT '' NOT NULL,
	"account_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"match_a" text[] DEFAULT '{}'::text[] NOT NULL,
	"match_b" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "identity_finding_status" DEFAULT 'open' NOT NULL,
	"accepted_by" uuid,
	"accepted_reason" text,
	"accepted_until" date,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_review_id_access_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."access_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_account_id_identity_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."identity_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_reviewer_position_id_positions_id_fk" FOREIGN KEY ("reviewer_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_review_items" ADD CONSTRAINT "access_review_items_remediated_by_users_id_fk" FOREIGN KEY ("remediated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_reviewer_position_id_positions_id_fk" FOREIGN KEY ("reviewer_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sod_rules" ADD CONSTRAINT "sod_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sod_violations" ADD CONSTRAINT "sod_violations_rule_id_sod_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."sod_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sod_violations" ADD CONSTRAINT "sod_violations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sod_violations" ADD CONSTRAINT "sod_violations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sod_violations" ADD CONSTRAINT "sod_violations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_review_items_review_idx" ON "access_review_items" USING btree ("review_id","reviewer_position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sod_violations_uq" ON "sod_violations" USING btree ("rule_id","subject");--> statement-breakpoint
CREATE INDEX "sod_violations_status_idx" ON "sod_violations" USING btree ("company_id","status");