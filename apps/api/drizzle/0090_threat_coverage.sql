CREATE TABLE "threat_assessments" (
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"asset_id" uuid NOT NULL,
	"catalog_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "threat_assessments_asset_id_catalog_id_pk" PRIMARY KEY("asset_id","catalog_id")
);
--> statement-breakpoint
ALTER TABLE "risk_scenario_proposals" ADD COLUMN "fingerprint_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "threat_assessments" ADD CONSTRAINT "threat_assessments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_assessments" ADD CONSTRAINT "threat_assessments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_assessments" ADD CONSTRAINT "threat_assessments_catalog_id_risk_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."risk_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_assessments" ADD CONSTRAINT "threat_assessments_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "threat_assessments_company_idx" ON "threat_assessments" USING btree ("company_id");