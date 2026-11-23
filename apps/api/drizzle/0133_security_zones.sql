CREATE TABLE "security_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" varchar(20) DEFAULT 'custom' NOT NULL,
	"trust" smallint DEFAULT 2 NOT NULL,
	"color" varchar(7) DEFAULT '#64748b' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cidrs" text[] DEFAULT '{}'::text[] NOT NULL,
	"sort_order" smallint DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "zone_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "zone_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "security_zones" ADD CONSTRAINT "security_zones_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_zones_company_idx" ON "security_zones" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_zone_id_security_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."security_zones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_zone_idx" ON "assets" USING btree ("zone_id");