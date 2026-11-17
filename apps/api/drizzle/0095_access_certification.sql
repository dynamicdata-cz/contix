CREATE TABLE "iam_certification_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"certification_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"decision" varchar(20),
	"comment" text,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"revoke_request_id" uuid
);
--> statement-breakpoint
CREATE TABLE "iam_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(200) NOT NULL,
	"reviewer" varchar(20) DEFAULT 'owner' NOT NULL,
	"resource_id" uuid,
	"privileged_only" boolean DEFAULT false NOT NULL,
	"due_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"created_by_id" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam_import_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"file_name" varchar(200) DEFAULT '' NOT NULL,
	"missing_as_left" boolean DEFAULT false NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_sha256" varchar(64),
	"last_result" jsonb,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "iam_certification_items" ADD CONSTRAINT "iam_certification_items_certification_id_iam_certifications_id_fk" FOREIGN KEY ("certification_id") REFERENCES "public"."iam_certifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_certification_items" ADD CONSTRAINT "iam_certification_items_grant_id_iam_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."iam_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_certification_items" ADD CONSTRAINT "iam_certification_items_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_certification_items" ADD CONSTRAINT "iam_certification_items_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_certification_items" ADD CONSTRAINT "iam_certification_items_revoke_request_id_iam_requests_id_fk" FOREIGN KEY ("revoke_request_id") REFERENCES "public"."iam_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_certifications" ADD CONSTRAINT "iam_certifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_certifications" ADD CONSTRAINT "iam_certifications_resource_id_iam_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."iam_resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_certifications" ADD CONSTRAINT "iam_certifications_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_import_settings" ADD CONSTRAINT "iam_import_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "iam_cert_items_uq" ON "iam_certification_items" USING btree ("certification_id","grant_id");--> statement-breakpoint
CREATE INDEX "iam_cert_items_reviewer_idx" ON "iam_certification_items" USING btree ("reviewer_id");--> statement-breakpoint
CREATE INDEX "iam_certifications_company_idx" ON "iam_certifications" USING btree ("company_id","status");