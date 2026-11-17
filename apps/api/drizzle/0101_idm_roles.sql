CREATE TABLE "iam_role_resources" (
	"role_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"owner_id" uuid,
	"department" varchar(200),
	"job_title" varchar(200),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "iam_requests" ADD COLUMN "sod_conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "iam_role_resources" ADD CONSTRAINT "iam_role_resources_role_id_iam_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."iam_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_role_resources" ADD CONSTRAINT "iam_role_resources_resource_id_iam_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."iam_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_roles" ADD CONSTRAINT "iam_roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_roles" ADD CONSTRAINT "iam_roles_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "iam_role_resources_uq" ON "iam_role_resources" USING btree ("role_id","resource_id");--> statement-breakpoint
CREATE INDEX "iam_role_resources_res_idx" ON "iam_role_resources" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iam_roles_name_uq" ON "iam_roles" USING btree ("company_id",lower("name"));