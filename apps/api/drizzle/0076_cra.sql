CREATE TABLE "cra_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" varchar(300) NOT NULL,
	"version" varchar(100),
	"purl" varchar(500),
	"supplier" varchar(300),
	"license" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cra_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"code" varchar(50),
	"name" varchar(300) NOT NULL,
	"version" varchar(100),
	"product_type" varchar(20) DEFAULT 'software' NOT NULL,
	"role" varchar(20) DEFAULT 'manufacturer' NOT NULL,
	"status" varchar(20) DEFAULT 'development' NOT NULL,
	"oss" boolean DEFAULT false NOT NULL,
	"description" text,
	"intended_purpose" text,
	"category" varchar(20),
	"category_item" varchar(40),
	"on_market_since" date,
	"support_until" date,
	"support_justification" text,
	"conformity_module" varchar(10),
	"harmonised_standards" text,
	"notified_body" varchar(300),
	"ce_marked_at" date,
	"doc_issued_at" date,
	"security_contact" varchar(500),
	"cvd_policy_url" text,
	"manufacturer_name" varchar(300),
	"member_states" text[] DEFAULT '{}'::text[] NOT NULL,
	"owner_position_id" uuid,
	"requirements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cra_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"title" varchar(300) NOT NULL,
	"aware_at" timestamp with time zone NOT NULL,
	"cve_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"malicious" boolean,
	"member_states" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"severity" text,
	"mitigation" text,
	"user_measures" text,
	"sensitivity" text,
	"root_cause" text,
	"actor_info" text,
	"srp_ref" varchar(100),
	"early_warning_at" timestamp with time zone,
	"notification_at" timestamp with time zone,
	"corrective_available_at" timestamp with time zone,
	"final_report_at" timestamp with time zone,
	"users_informed_at" timestamp with time zone,
	"closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cra_components" ADD CONSTRAINT "cra_components_product_id_cra_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."cra_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cra_products" ADD CONSTRAINT "cra_products_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cra_products" ADD CONSTRAINT "cra_products_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cra_reports" ADD CONSTRAINT "cra_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cra_reports" ADD CONSTRAINT "cra_reports_product_id_cra_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."cra_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cra_components_product_idx" ON "cra_components" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "cra_products_company_idx" ON "cra_products" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "cra_reports_product_idx" ON "cra_reports" USING btree ("product_id");