CREATE TABLE "soc_enrichments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"provider" varchar(10) NOT NULL,
	"analyzer" varchar(200) NOT NULL,
	"type" varchar(10) NOT NULL,
	"value" varchar(2000) NOT NULL,
	"status" varchar(10) DEFAULT 'running' NOT NULL,
	"job_id" varchar(100),
	"verdict" varchar(12),
	"taxonomies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"report" jsonb,
	"error" text,
	"alert_id" uuid,
	"ioc_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "soc_iocs" ADD COLUMN "misp_event_id" varchar(60);--> statement-breakpoint
ALTER TABLE "soc_iocs" ADD COLUMN "misp_shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "soc_enrichments" ADD CONSTRAINT "soc_enrichments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_enrichments" ADD CONSTRAINT "soc_enrichments_alert_id_alert_suggestions_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alert_suggestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_enrichments" ADD CONSTRAINT "soc_enrichments_ioc_id_soc_iocs_id_fk" FOREIGN KEY ("ioc_id") REFERENCES "public"."soc_iocs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_enrichments" ADD CONSTRAINT "soc_enrichments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "soc_enrichments_alert_idx" ON "soc_enrichments" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "soc_enrichments_ioc_idx" ON "soc_enrichments" USING btree ("ioc_id");--> statement-breakpoint
CREATE INDEX "soc_enrichments_value_idx" ON "soc_enrichments" USING btree ("type","value");