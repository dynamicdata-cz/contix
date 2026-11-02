CREATE TABLE "asset_companies" (
	"asset_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_companies_asset_id_company_id_pk" PRIMARY KEY("asset_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "risk_catalog_links" (
	"risk_id" uuid NOT NULL,
	"catalog_id" uuid NOT NULL,
	CONSTRAINT "risk_catalog_links_risk_id_catalog_id_pk" PRIMARY KEY("risk_id","catalog_id")
);
--> statement-breakpoint
ALTER TABLE "asset_companies" ADD CONSTRAINT "asset_companies_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_companies" ADD CONSTRAINT "asset_companies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_catalog_links" ADD CONSTRAINT "risk_catalog_links_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_catalog_links" ADD CONSTRAINT "risk_catalog_links_catalog_id_risk_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."risk_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_companies_company_idx" ON "asset_companies" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "risk_catalog_links_catalog_idx" ON "risk_catalog_links" USING btree ("catalog_id");