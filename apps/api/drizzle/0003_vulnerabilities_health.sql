CREATE TYPE "public"."health_status" AS ENUM('green', 'orange', 'red', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."vuln_severity" AS ENUM('critical', 'high', 'medium', 'low', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."support_status" AS ENUM('supported', 'ending', 'eol', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."vuln_status" AS ENUM('open', 'accepted', 'resolved');--> statement-breakpoint
CREATE TABLE "asset_vulnerabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"cve_id" varchar(100) NOT NULL,
	"severity" "vuln_severity" DEFAULT 'unknown' NOT NULL,
	"cvss_score" real,
	"package_name" varchar(500) DEFAULT '' NOT NULL,
	"package_version" varchar(255) DEFAULT '' NOT NULL,
	"description" text,
	"reference" text,
	"published_at" timestamp with time zone,
	"detected_at" timestamp with time zone,
	"source_type" "source_type" DEFAULT 'wazuh' NOT NULL,
	"status" "vuln_status" DEFAULT 'open' NOT NULL,
	"accepted_by" uuid,
	"accepted_reason" text,
	"accepted_until" date,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "health_status" "health_status" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "health_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "health_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "vuln_critical" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "vuln_high" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "vuln_medium" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "vuln_low" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "support_status" "support_status" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "os_eol_date" date;--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD CONSTRAINT "asset_vulnerabilities_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD CONSTRAINT "asset_vulnerabilities_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_vuln_uq" ON "asset_vulnerabilities" USING btree ("asset_id","cve_id","package_name","package_version");--> statement-breakpoint
CREATE INDEX "asset_vuln_status_idx" ON "asset_vulnerabilities" USING btree ("status","severity");--> statement-breakpoint
CREATE INDEX "asset_vuln_cve_idx" ON "asset_vulnerabilities" USING btree ("cve_id");--> statement-breakpoint
CREATE INDEX "assets_health_idx" ON "assets" USING btree ("health_status");