CREATE TYPE "public"."company_kind" AS ENUM('holding', 'company');
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"kind" "company_kind" DEFAULT 'company' NOT NULL,
	"name" varchar(300) NOT NULL,
	"short_name" varchar(50),
	"ico" varchar(20),
	"address" text,
	"regulated_services" text,
	"regime" varchar(10) DEFAULT 'higher' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Kořenová společnost z dosavadního nastavení organizace (ROOT_COMPANY_ID)
INSERT INTO "companies" ("id", "kind", "name", "ico", "address", "regulated_services", "regime")
SELECT '00000000-0000-4000-8000-000000000001', 'holding',
  coalesce((SELECT value #>> '{}' FROM app_settings WHERE key = 'organizationName'), 'Moje organizace'),
  nullif((SELECT value #>> '{}' FROM app_settings WHERE key = 'organizationIco'), ''),
  nullif((SELECT value #>> '{}' FROM app_settings WHERE key = 'organizationAddress'), ''),
  nullif((SELECT value #>> '{}' FROM app_settings WHERE key = 'regulatedServices'), ''),
  coalesce((SELECT value #>> '{}' FROM app_settings WHERE key = 'regime'), 'higher')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "bia_assessments" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "changes" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "continuity_plans" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "controls" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "group_roles" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "isms_objectives" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "org_units" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "processes" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "requirement_assessments" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_roles" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL;
--> statement-breakpoint
DROP INDEX "document_versions_uq";
--> statement-breakpoint
ALTER TABLE "group_roles" DROP CONSTRAINT "group_roles_group_id_role_id_pk";
--> statement-breakpoint
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_user_id_role_id_source_pk";
--> statement-breakpoint
ALTER TABLE "requirement_assessments" DROP CONSTRAINT "requirement_assessments_pkey";
--> statement-breakpoint
ALTER TABLE "group_roles" ADD CONSTRAINT "group_roles_group_id_role_id_company_id_pk" PRIMARY KEY("group_id","role_id","company_id");
--> statement-breakpoint
ALTER TABLE "requirement_assessments" ADD CONSTRAINT "requirement_assessments_company_id_requirement_id_pk" PRIMARY KEY("company_id","requirement_id");
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_role_id_source_company_id_pk" PRIMARY KEY("user_id","role_id","source","company_id");
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bia_assessments" ADD CONSTRAINT "bia_assessments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "changes" ADD CONSTRAINT "changes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "continuity_plans" ADD CONSTRAINT "continuity_plans_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "controls" ADD CONSTRAINT "controls_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "group_roles" ADD CONSTRAINT "group_roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "isms_objectives" ADD CONSTRAINT "isms_objectives_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "processes" ADD CONSTRAINT "processes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "requirement_assessments" ADD CONSTRAINT "requirement_assessments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_uq" ON "document_versions" USING btree ("company_id","kind","framework","version");
