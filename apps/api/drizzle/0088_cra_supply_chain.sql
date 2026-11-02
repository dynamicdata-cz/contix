CREATE TABLE "cra_advisories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"publisher" varchar(300) NOT NULL,
	"namespace" varchar(300) NOT NULL,
	"tracking_id" varchar(200) NOT NULL,
	"version" varchar(50) NOT NULL,
	"title" varchar(500) NOT NULL,
	"current_release" varchar(40),
	"data" jsonb NOT NULL,
	"file_sha256" varchar(64) NOT NULL,
	"uploaded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cra_product_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"check_key" varchar(40),
	"file_name" varchar(255) NOT NULL,
	"file_mime" varchar(100) NOT NULL,
	"file_size" integer NOT NULL,
	"file_sha256" varchar(64) NOT NULL,
	"content" "bytea" NOT NULL,
	"uploaded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cra_findings" ADD COLUMN "vendor_status" varchar(30);--> statement-breakpoint
ALTER TABLE "cra_products" ADD COLUMN "cpe" varchar(500);--> statement-breakpoint
ALTER TABLE "cra_products" ADD COLUMN "supply_checks" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cra_advisories" ADD CONSTRAINT "cra_advisories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cra_advisories" ADD CONSTRAINT "cra_advisories_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cra_product_files" ADD CONSTRAINT "cra_product_files_product_id_cra_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."cra_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cra_product_files" ADD CONSTRAINT "cra_product_files_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cra_advisories_uq" ON "cra_advisories" USING btree ("company_id","namespace","tracking_id");--> statement-breakpoint
CREATE INDEX "cra_product_files_product_idx" ON "cra_product_files" USING btree ("product_id");