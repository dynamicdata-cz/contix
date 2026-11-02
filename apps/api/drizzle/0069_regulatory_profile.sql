ALTER TABLE "audits" ALTER COLUMN "methodology_key" SET DATA TYPE varchar(60);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "pack" varchar(20) DEFAULT 'cz' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "primary_framework" varchar(50);