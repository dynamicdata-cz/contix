CREATE TABLE "policy_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"parent_id" uuid,
	"name" varchar(200) NOT NULL,
	"code_prefix" varchar(15),
	"position" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(200) NOT NULL,
	"doc_type" "policy_type",
	"filename" varchar(255) NOT NULL,
	"mime" varchar(150) NOT NULL,
	"size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" "bytea" NOT NULL,
	"uploaded_by_id" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "retention_years" smallint;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "retention_mark" varchar(1);--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "retired_at" date;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "disposed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "disposed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "disposal_mode" varchar(20);--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "disposal_reference" varchar(200);--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "disposal_note" text;--> statement-breakpoint
ALTER TABLE "policy_files" ADD COLUMN "revision" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "policy_files" ADD COLUMN "replaces_id" uuid;--> statement-breakpoint
ALTER TABLE "policy_files" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "policy_files" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD COLUMN "locked_by_id" uuid;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "policy_folders" ADD CONSTRAINT "policy_folders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_folders" ADD CONSTRAINT "policy_folders_parent_id_policy_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."policy_folders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_templates" ADD CONSTRAINT "policy_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_templates" ADD CONSTRAINT "policy_templates_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policy_folders_company_idx" ON "policy_folders" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "policy_templates_company_idx" ON "policy_templates" USING btree ("company_id");--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_folder_id_policy_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."policy_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_disposed_by_id_users_id_fk" FOREIGN KEY ("disposed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_files" ADD CONSTRAINT "policy_files_replaces_id_policy_files_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."policy_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_locked_by_id_users_id_fk" FOREIGN KEY ("locked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;