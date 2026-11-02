ALTER TABLE "soc_sources" ADD COLUMN "pull_config" jsonb;--> statement-breakpoint
ALTER TABLE "soc_sources" ADD COLUMN "secret_enc" text;--> statement-breakpoint
ALTER TABLE "soc_sources" ADD COLUMN "pull_cursor" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "soc_sources" ADD COLUMN "last_pull_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "soc_sources" ADD COLUMN "last_pull" jsonb;