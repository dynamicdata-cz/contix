CREATE TYPE "public"."asset_type" AS ENUM('server', 'workstation', 'laptop', 'virtual_machine', 'container', 'network_device', 'security_device', 'storage', 'mobile_device', 'iot_ot', 'printer', 'cloud_resource', 'application', 'database', 'saas_service', 'information_asset', 'facility', 'other');--> statement-breakpoint
CREATE TYPE "public"."discovery_connector" AS ENUM('wazuh', 'network_scan', 'csv_import');--> statement-breakpoint
CREATE TYPE "public"."criticality" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."environment" AS ENUM('production', 'test', 'development', 'other');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_status" AS ENUM('planned', 'active', 'maintenance', 'retired', 'disposed');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('manual', 'wazuh', 'network_scan', 'import');--> statement-breakpoint
CREATE TABLE "asset_software" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"version" varchar(255),
	"vendor" varchar(255),
	"source_type" "source_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_ref" varchar(255) NOT NULL,
	"raw" jsonb,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"asset_type" "asset_type" NOT NULL,
	"description" text,
	"hostname" varchar(255),
	"fqdn" varchar(255),
	"ip_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
	"mac_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
	"os_name" varchar(255),
	"os_version" varchar(255),
	"manufacturer" varchar(255),
	"model" varchar(255),
	"serial_number" varchar(255),
	"location" varchar(255),
	"owner_name" varchar(255),
	"criticality" "criticality" DEFAULT 'medium' NOT NULL,
	"confidentiality" smallint,
	"integrity" smallint,
	"availability" smallint,
	"lifecycle_status" "lifecycle_status" DEFAULT 'active' NOT NULL,
	"environment" "environment",
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector" "discovery_connector" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_software" ADD CONSTRAINT "asset_software_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_sources" ADD CONSTRAINT "asset_sources_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_software_asset_idx" ON "asset_software" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_sources_ref_uq" ON "asset_sources" USING btree ("source_type","source_ref");--> statement-breakpoint
CREATE INDEX "asset_sources_asset_idx" ON "asset_sources" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "assets_type_idx" ON "assets" USING btree ("asset_type");--> statement-breakpoint
CREATE INDEX "assets_hostname_idx" ON "assets" USING btree (lower("hostname"));--> statement-breakpoint
CREATE INDEX "assets_serial_idx" ON "assets" USING btree ("serial_number");--> statement-breakpoint
CREATE INDEX "assets_ip_gin" ON "assets" USING gin ("ip_addresses");--> statement-breakpoint
CREATE INDEX "assets_mac_gin" ON "assets" USING gin ("mac_addresses");