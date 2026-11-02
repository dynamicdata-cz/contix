CREATE TABLE "soc_ioc_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(120) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"token_prefix" varchar(12) NOT NULL,
	"fetches" integer DEFAULT 0 NOT NULL,
	"last_fetch_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "soc_iocs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"type" varchar(10) NOT NULL,
	"value" varchar(2000) NOT NULL,
	"action" varchar(10) DEFAULT 'block' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"valid_until" date,
	"source_alert_id" uuid,
	"last_hunt" jsonb,
	"revoked_at" timestamp with time zone,
	"revoked_by_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "soc_ioc_feeds" ADD CONSTRAINT "soc_ioc_feeds_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_ioc_feeds" ADD CONSTRAINT "soc_ioc_feeds_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_iocs" ADD CONSTRAINT "soc_iocs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_iocs" ADD CONSTRAINT "soc_iocs_source_alert_id_alert_suggestions_id_fk" FOREIGN KEY ("source_alert_id") REFERENCES "public"."alert_suggestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_iocs" ADD CONSTRAINT "soc_iocs_revoked_by_id_users_id_fk" FOREIGN KEY ("revoked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_iocs" ADD CONSTRAINT "soc_iocs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "soc_ioc_feeds_token_uq" ON "soc_ioc_feeds" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "soc_iocs_value_uq" ON "soc_iocs" USING btree ("company_id","type","value");--> statement-breakpoint
CREATE INDEX "soc_iocs_alert_idx" ON "soc_iocs" USING btree ("source_alert_id");