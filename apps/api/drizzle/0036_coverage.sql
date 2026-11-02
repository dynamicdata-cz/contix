CREATE TABLE "coverage_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"framework" varchar(20) NOT NULL,
	"note" text,
	"summary" jsonb NOT NULL,
	"rows" jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coverage_snapshots" ADD CONSTRAINT "coverage_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coverage_snapshots" ADD CONSTRAINT "coverage_snapshots_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coverage_snapshots_company_idx" ON "coverage_snapshots" USING btree ("company_id","framework","created_at");