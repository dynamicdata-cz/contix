CREATE TABLE "trend_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"period" varchar(7) NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trend_snapshots" ADD CONSTRAINT "trend_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trend_snapshots_company_period_uq" ON "trend_snapshots" USING btree ("company_id","period");