CREATE TABLE "sec_test_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"scope_id" uuid NOT NULL,
	"name" varchar(200) DEFAULT '' NOT NULL,
	"auto_follow" boolean DEFAULT true NOT NULL,
	"auto_ai" boolean DEFAULT false NOT NULL,
	"requested_by_id" uuid,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sec_test_runs" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "sec_test_runs" ADD COLUMN "parent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "sec_test_batches" ADD CONSTRAINT "sec_test_batches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_test_batches" ADD CONSTRAINT "sec_test_batches_scope_id_sec_test_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."sec_test_scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_test_batches" ADD CONSTRAINT "sec_test_batches_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sec_test_batches_company_idx" ON "sec_test_batches" USING btree ("company_id","created_at");--> statement-breakpoint
ALTER TABLE "sec_test_runs" ADD CONSTRAINT "sec_test_runs_batch_id_sec_test_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."sec_test_batches"("id") ON DELETE cascade ON UPDATE no action;