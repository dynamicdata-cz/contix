CREATE TABLE "tls_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"host" varchar(253) NOT NULL,
	"port" integer DEFAULT 443 NOT NULL,
	"server_name" varchar(253),
	"asset_id" uuid,
	"note" varchar(500),
	"enabled" boolean DEFAULT true NOT NULL,
	"last_scan_at" timestamp with time zone,
	"not_after" timestamp with time zone,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tls_endpoints" ADD CONSTRAINT "tls_endpoints_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tls_endpoints" ADD CONSTRAINT "tls_endpoints_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tls_endpoints_uq" ON "tls_endpoints" USING btree ("company_id","host","port");--> statement-breakpoint
CREATE INDEX "tls_endpoints_asset_idx" ON "tls_endpoints" USING btree ("asset_id");