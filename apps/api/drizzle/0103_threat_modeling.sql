CREATE TABLE "attack_path_decisions" (
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"path_key" varchar(200) NOT NULL,
	"status" varchar(20) NOT NULL,
	"risk_id" uuid,
	"reason" text,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attack_path_decisions_company_id_path_key_pk" PRIMARY KEY("company_id","path_key")
);
--> statement-breakpoint
CREATE TABLE "threat_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(300) NOT NULL,
	"scope" varchar(20) DEFAULT 'application' NOT NULL,
	"scope_id" uuid,
	"description" text,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"elements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"threats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threat_profiles" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"sector" varchar(40),
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attack_path_decisions" ADD CONSTRAINT "attack_path_decisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_path_decisions" ADD CONSTRAINT "attack_path_decisions_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attack_path_decisions" ADD CONSTRAINT "attack_path_decisions_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_models" ADD CONSTRAINT "threat_models_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_models" ADD CONSTRAINT "threat_models_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_profiles" ADD CONSTRAINT "threat_profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threat_profiles" ADD CONSTRAINT "threat_profiles_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "threat_models_company_idx" ON "threat_models" USING btree ("company_id");