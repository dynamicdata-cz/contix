CREATE TABLE "cra_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"product_id" uuid NOT NULL,
	"component_ref" varchar(500) NOT NULL,
	"vuln_id" varchar(100) NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"summary" text,
	"severity" varchar(200),
	"source" varchar(10) DEFAULT 'osv' NOT NULL,
	"status" varchar(30) DEFAULT 'under_investigation' NOT NULL,
	"justification" varchar(60),
	"impact_statement" text,
	"action_statement" text,
	"gone" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "osv_packages" (
	"osv_id" varchar(100) NOT NULL,
	"ecosystem" varchar(40) NOT NULL,
	"name" varchar(300) NOT NULL,
	CONSTRAINT "osv_packages_osv_id_ecosystem_name_pk" PRIMARY KEY("osv_id","ecosystem","name")
);
--> statement-breakpoint
CREATE TABLE "osv_records" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"summary" text,
	"severity" varchar(200),
	"modified" timestamp with time zone,
	"withdrawn" boolean DEFAULT false NOT NULL,
	"affected" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ecosystems" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cra_findings" ADD CONSTRAINT "cra_findings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cra_findings" ADD CONSTRAINT "cra_findings_product_id_cra_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."cra_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "osv_packages" ADD CONSTRAINT "osv_packages_osv_id_osv_records_id_fk" FOREIGN KEY ("osv_id") REFERENCES "public"."osv_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cra_findings_uq" ON "cra_findings" USING btree ("product_id","component_ref","vuln_id");--> statement-breakpoint
CREATE INDEX "cra_findings_company_idx" ON "cra_findings" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "osv_packages_lookup_idx" ON "osv_packages" USING btree ("ecosystem","name");