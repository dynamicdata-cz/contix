CREATE TABLE "monitoring_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"connection_id" uuid,
	"asset_id" uuid,
	"key" varchar(120) NOT NULL,
	"code" varchar(60) NOT NULL,
	"severity" varchar(10) NOT NULL,
	"subject" varchar(500) NOT NULL,
	"detail" varchar(2000),
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"note" text,
	"accepted_by_id" uuid,
	"accepted_at" timestamp with time zone,
	"accepted_until" date,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fixed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitoring_findings" ADD CONSTRAINT "monitoring_findings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_findings" ADD CONSTRAINT "monitoring_findings_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_findings" ADD CONSTRAINT "monitoring_findings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_findings" ADD CONSTRAINT "monitoring_findings_accepted_by_id_users_id_fk" FOREIGN KEY ("accepted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_findings_key_uq" ON "monitoring_findings" USING btree ("key","code");--> statement-breakpoint
CREATE INDEX "monitoring_findings_company_idx" ON "monitoring_findings" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "monitoring_findings_asset_idx" ON "monitoring_findings" USING btree ("asset_id");