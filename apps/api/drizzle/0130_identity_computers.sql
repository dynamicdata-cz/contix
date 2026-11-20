ALTER TYPE "public"."source_type" ADD VALUE 'ad';--> statement-breakpoint
CREATE TABLE "identity_computers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"external_id" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"dns_name" varchar(255),
	"dn" text NOT NULL,
	"os" varchar(255),
	"os_version" varchar(100),
	"role" varchar(20) DEFAULT 'other' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_logon_at" timestamp with time zone,
	"pwd_last_set_at" timestamp with time zone,
	"dir_created_at" timestamp with time zone,
	"description" text,
	"spns" text[] DEFAULT '{}'::text[] NOT NULL,
	"unconstrained_delegation" boolean DEFAULT false NOT NULL,
	"constrained_delegation" boolean DEFAULT false NOT NULL,
	"laps" boolean DEFAULT false NOT NULL,
	"asset_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "identity_computers_src_uq" UNIQUE("source_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "identity_findings" ADD COLUMN "computer_id" uuid;--> statement-breakpoint
ALTER TABLE "identity_computers" ADD CONSTRAINT "identity_computers_source_id_identity_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."identity_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_computers" ADD CONSTRAINT "identity_computers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_computers" ADD CONSTRAINT "identity_computers_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_computers_company_idx" ON "identity_computers" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "identity_computers_asset_idx" ON "identity_computers" USING btree ("asset_id");--> statement-breakpoint
ALTER TABLE "identity_findings" ADD CONSTRAINT "identity_findings_computer_id_identity_computers_id_fk" FOREIGN KEY ("computer_id") REFERENCES "public"."identity_computers"("id") ON DELETE cascade ON UPDATE no action;