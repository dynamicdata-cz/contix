CREATE TABLE "capability_declarations" (
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"key" varchar(40) NOT NULL,
	"status" varchar(20) NOT NULL,
	"product" varchar(200),
	"note" text,
	"url" text,
	"valid_until" date,
	"declared_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_declarations_company_id_key_pk" PRIMARY KEY("company_id","key")
);
--> statement-breakpoint
CREATE TABLE "risk_scenario_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"template_key" varchar(40) NOT NULL,
	"primary_asset_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'proposed' NOT NULL,
	"levels" smallint NOT NULL,
	"impact" smallint NOT NULL,
	"threat_level" smallint NOT NULL,
	"vuln_level" smallint NOT NULL,
	"likelihood" smallint NOT NULL,
	"low_confidence" boolean DEFAULT false NOT NULL,
	"evidence" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"decided_fingerprint" text,
	"risk_id" uuid,
	"reason" text,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capability_declarations" ADD CONSTRAINT "capability_declarations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_declarations" ADD CONSTRAINT "capability_declarations_declared_by_id_users_id_fk" FOREIGN KEY ("declared_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_scenario_proposals" ADD CONSTRAINT "risk_scenario_proposals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_scenario_proposals" ADD CONSTRAINT "risk_scenario_proposals_primary_asset_id_assets_id_fk" FOREIGN KEY ("primary_asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_scenario_proposals" ADD CONSTRAINT "risk_scenario_proposals_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_scenario_proposals" ADD CONSTRAINT "risk_scenario_proposals_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "risk_scenario_proposals_uq" ON "risk_scenario_proposals" USING btree ("company_id","template_key","primary_asset_id");--> statement-breakpoint
CREATE INDEX "risk_scenario_proposals_risk_idx" ON "risk_scenario_proposals" USING btree ("risk_id");