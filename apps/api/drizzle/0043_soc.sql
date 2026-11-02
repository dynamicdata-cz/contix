ALTER TYPE "public"."alert_suggestion_status" ADD VALUE 'in_progress' BEFORE 'accepted';--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD COLUMN "title" varchar(300);--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD COLUMN "verdict" varchar(20);--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD COLUMN "mitre_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD COLUMN "mitre_tactics" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD COLUMN "playbook_key" varchar(40);--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD COLUMN "playbook_done" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD COLUMN "notes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD COLUMN "ai_advice" jsonb;--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD COLUMN "created_by_id" uuid;--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD CONSTRAINT "alert_suggestions_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD CONSTRAINT "alert_suggestions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_suggestions_company_idx" ON "alert_suggestions" USING btree ("company_id","status");