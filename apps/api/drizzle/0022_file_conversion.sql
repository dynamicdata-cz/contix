ALTER TABLE "policy_files" ADD COLUMN "pdf_status" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "policy_files" ADD COLUMN "pdf_error" text;--> statement-breakpoint
ALTER TABLE "policy_files" ADD COLUMN "pdf" "bytea";--> statement-breakpoint
ALTER TABLE "policy_files" ADD COLUMN "pdf_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "policy_files" ADD COLUMN "text" text;--> statement-breakpoint
ALTER TABLE "policy_files" ADD COLUMN "search_text" text;