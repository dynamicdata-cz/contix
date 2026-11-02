ALTER TYPE "public"."vuln_status" ADD VALUE 'false_positive';--> statement-breakpoint
ALTER TYPE "public"."vuln_status" ADD VALUE 'out_of_scope';--> statement-breakpoint
ALTER TYPE "public"."vuln_status" ADD VALUE 'duplicate';--> statement-breakpoint
CREATE TABLE "vuln_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"scanner" varchar(30) NOT NULL,
	"name" varchar(200) DEFAULT '' NOT NULL,
	"file_name" varchar(255) DEFAULT '' NOT NULL,
	"file_sha256" varchar(64) DEFAULT '' NOT NULL,
	"asset_id" uuid,
	"external" boolean DEFAULT false NOT NULL,
	"close_missing" boolean DEFAULT true NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unmatched_hosts" text[] DEFAULT '{}'::text[] NOT NULL,
	"imported_by_id" uuid,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "asset_vuln_uq";--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "finding_key" varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "scanner" varchar(30) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "scan_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "title" varchar(500);--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "cwe" integer;--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "endpoint" varchar(500) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "related_cves" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "fixed_version" varchar(255);--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "remediation" text;--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "exposed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "duplicate_of_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "triage_reason" text;--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "triaged_by" uuid;--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "triaged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "internet_facing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vuln_scans" ADD CONSTRAINT "vuln_scans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vuln_scans" ADD CONSTRAINT "vuln_scans_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vuln_scans" ADD CONSTRAINT "vuln_scans_imported_by_id_users_id_fk" FOREIGN KEY ("imported_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vuln_scans_company_idx" ON "vuln_scans" USING btree ("company_id","imported_at");--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD CONSTRAINT "asset_vulnerabilities_scan_id_vuln_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."vuln_scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD CONSTRAINT "asset_vulnerabilities_triaged_by_users_id_fk" FOREIGN KEY ("triaged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_vuln_scanner_idx" ON "asset_vulnerabilities" USING btree ("scanner","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_vuln_uq" ON "asset_vulnerabilities" USING btree ("asset_id","cve_id","package_name","package_version","finding_key");