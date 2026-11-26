ALTER TABLE "cra_findings" ADD COLUMN "fixed_version" varchar(255);--> statement-breakpoint
ALTER TABLE "cra_findings" ADD COLUMN "fix_links" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "cra_products" ADD COLUMN "harbor_ref" varchar(500);--> statement-breakpoint
ALTER TABLE "cra_products" ADD COLUMN "harbor_state" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "osv_records" ADD COLUMN "references" jsonb DEFAULT '[]'::jsonb NOT NULL;