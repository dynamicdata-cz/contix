ALTER TYPE "public"."vuln_status" ADD VALUE 'suppressed';--> statement-breakpoint
CREATE TABLE "vuln_suppression_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(200) NOT NULL,
	"criteria" jsonb NOT NULL,
	"reason" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_applied_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "suppressed_until" date;--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD COLUMN "suppress_rule_id" uuid;--> statement-breakpoint
ALTER TABLE "vuln_suppression_rules" ADD CONSTRAINT "vuln_suppression_rules_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vuln_suppression_rules" ADD CONSTRAINT "vuln_suppression_rules_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vuln_suppression_rules_company_idx" ON "vuln_suppression_rules" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "asset_vulnerabilities" ADD CONSTRAINT "asset_vulnerabilities_suppress_rule_id_vuln_suppression_rules_id_fk" FOREIGN KEY ("suppress_rule_id") REFERENCES "public"."vuln_suppression_rules"("id") ON DELETE set null ON UPDATE no action;