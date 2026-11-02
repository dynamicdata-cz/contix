CREATE TABLE "soc_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(120) NOT NULL,
	"preset" varchar(20) NOT NULL,
	"default_severity" varchar(10) DEFAULT 'medium' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"token_prefix" varchar(12) NOT NULL,
	"events_total" integer DEFAULT 0 NOT NULL,
	"alerts_created" integer DEFAULT 0 NOT NULL,
	"last_event_at" timestamp with time zone,
	"last_error" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "soc_sources" ADD CONSTRAINT "soc_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_sources" ADD CONSTRAINT "soc_sources_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "soc_sources_token_uq" ON "soc_sources" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "soc_sources_company_idx" ON "soc_sources" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD CONSTRAINT "alert_suggestions_source_id_soc_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."soc_sources"("id") ON DELETE set null ON UPDATE no action;