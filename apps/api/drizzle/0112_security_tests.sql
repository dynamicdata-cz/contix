CREATE TABLE "sec_test_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"key" varchar(64) NOT NULL,
	"run_id" uuid NOT NULL,
	"test_id" varchar(40) NOT NULL,
	"code" varchar(200) NOT NULL,
	"severity" varchar(10) NOT NULL,
	"title" varchar(500) NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"host" varchar(300) NOT NULL,
	"port" integer,
	"evidence" text DEFAULT '' NOT NULL,
	"asset_id" uuid,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"note" text,
	"advice" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fixed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sec_test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"scope_id" uuid NOT NULL,
	"test_id" varchar(40) NOT NULL,
	"targets" text[] DEFAULT '{}'::text[] NOT NULL,
	"ports" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"source" varchar(10) NOT NULL,
	"probe_id" uuid,
	"status" varchar(12) DEFAULT 'queued' NOT NULL,
	"error" text,
	"requested_by_id" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"outputs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" text[] DEFAULT '{}'::text[] NOT NULL,
	"summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sec_test_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(200) NOT NULL,
	"targets" text[] DEFAULT '{}'::text[] NOT NULL,
	"exclusions" text[] DEFAULT '{}'::text[] NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date NOT NULL,
	"authorization" text NOT NULL,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"created_by_id" uuid,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sec_test_findings" ADD CONSTRAINT "sec_test_findings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_test_findings" ADD CONSTRAINT "sec_test_findings_run_id_sec_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."sec_test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_test_findings" ADD CONSTRAINT "sec_test_findings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_test_runs" ADD CONSTRAINT "sec_test_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_test_runs" ADD CONSTRAINT "sec_test_runs_scope_id_sec_test_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."sec_test_scopes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_test_runs" ADD CONSTRAINT "sec_test_runs_probe_id_connections_id_fk" FOREIGN KEY ("probe_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_test_runs" ADD CONSTRAINT "sec_test_runs_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_test_scopes" ADD CONSTRAINT "sec_test_scopes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_test_scopes" ADD CONSTRAINT "sec_test_scopes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sec_test_scopes" ADD CONSTRAINT "sec_test_scopes_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sec_test_findings_key_uq" ON "sec_test_findings" USING btree ("company_id","key");--> statement-breakpoint
CREATE INDEX "sec_test_findings_asset_idx" ON "sec_test_findings" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "sec_test_findings_run_idx" ON "sec_test_findings" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "sec_test_runs_company_idx" ON "sec_test_runs" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "sec_test_runs_status_idx" ON "sec_test_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sec_test_scopes_company_idx" ON "sec_test_scopes" USING btree ("company_id");