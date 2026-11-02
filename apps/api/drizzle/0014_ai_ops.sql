CREATE TYPE "public"."ai_suggestion_status" AS ENUM('running', 'proposed', 'accepted', 'partially_accepted', 'rejected', 'failed');--> statement-breakpoint
CREATE TABLE "ai_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"use_case" varchar(50) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" uuid NOT NULL,
	"status" "ai_suggestion_status" DEFAULT 'proposed' NOT NULL,
	"provider" varchar(20) NOT NULL,
	"model" varchar(200) NOT NULL,
	"input" jsonb NOT NULL,
	"raw_output" text,
	"summary" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accepted_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"duration_ms" integer,
	"created_by_id" uuid,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" varchar(10) NOT NULL,
	"file" varchar(500),
	"size_bytes" bigint,
	"encrypted" boolean DEFAULT false NOT NULL,
	"host" varchar(200),
	"message" text
);
--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_suggestions_entity_idx" ON "ai_suggestions" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "ai_suggestions_created_idx" ON "ai_suggestions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "backup_runs_started_idx" ON "backup_runs" USING btree ("started_at");