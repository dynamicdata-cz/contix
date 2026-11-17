CREATE TABLE "iam_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"step" integer NOT NULL,
	"kind" varchar(20) NOT NULL,
	"approver_id" uuid,
	"decision" varchar(20),
	"comment" text,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "iam_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"person_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"since" date NOT NULL,
	"valid_until" date,
	"request_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam_people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"personal_number" varchar(50),
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"email" varchar(320),
	"login" varchar(200),
	"department" varchar(200),
	"job_title" varchar(200),
	"kind" varchar(20) DEFAULT 'employee' NOT NULL,
	"manager_id" uuid,
	"start_date" date,
	"end_date" date,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"person_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"action" varchar(10) DEFAULT 'grant' NOT NULL,
	"origin" varchar(20) DEFAULT 'request' NOT NULL,
	"justification" text NOT NULL,
	"valid_until" date,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"requested_by_id" uuid,
	"fulfilled_by_id" uuid,
	"fulfilled_at" timestamp with time zone,
	"fulfil_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam_resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(200) NOT NULL,
	"kind" varchar(20) DEFAULT 'application' NOT NULL,
	"description" text,
	"asset_id" uuid,
	"ad_group" varchar(500),
	"owner_id" uuid,
	"approval_manager" boolean DEFAULT true NOT NULL,
	"approval_owner" boolean DEFAULT true NOT NULL,
	"max_days" integer,
	"privileged" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "iam_approvals" ADD CONSTRAINT "iam_approvals_request_id_iam_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."iam_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_approvals" ADD CONSTRAINT "iam_approvals_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_approvals" ADD CONSTRAINT "iam_approvals_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_grants" ADD CONSTRAINT "iam_grants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_grants" ADD CONSTRAINT "iam_grants_person_id_iam_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."iam_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_grants" ADD CONSTRAINT "iam_grants_resource_id_iam_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."iam_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_grants" ADD CONSTRAINT "iam_grants_request_id_iam_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."iam_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_grants" ADD CONSTRAINT "iam_grants_revoke_request_id_iam_requests_id_fk" FOREIGN KEY ("revoke_request_id") REFERENCES "public"."iam_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_people" ADD CONSTRAINT "iam_people_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_people" ADD CONSTRAINT "iam_people_manager_id_iam_people_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."iam_people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_requests" ADD CONSTRAINT "iam_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_requests" ADD CONSTRAINT "iam_requests_person_id_iam_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."iam_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_requests" ADD CONSTRAINT "iam_requests_resource_id_iam_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."iam_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_requests" ADD CONSTRAINT "iam_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_requests" ADD CONSTRAINT "iam_requests_fulfilled_by_id_users_id_fk" FOREIGN KEY ("fulfilled_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_resources" ADD CONSTRAINT "iam_resources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_resources" ADD CONSTRAINT "iam_resources_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_resources" ADD CONSTRAINT "iam_resources_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "iam_approvals_step_uq" ON "iam_approvals" USING btree ("request_id","step");--> statement-breakpoint
CREATE INDEX "iam_approvals_approver_idx" ON "iam_approvals" USING btree ("approver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iam_grants_active_uq" ON "iam_grants" USING btree ("person_id","resource_id") WHERE "iam_grants"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "iam_grants_resource_idx" ON "iam_grants" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iam_people_number_uq" ON "iam_people" USING btree ("company_id","personal_number");--> statement-breakpoint
CREATE INDEX "iam_people_email_idx" ON "iam_people" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "iam_people_manager_idx" ON "iam_people" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "iam_requests_status_idx" ON "iam_requests" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "iam_requests_person_idx" ON "iam_requests" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "iam_resources_name_uq" ON "iam_resources" USING btree ("company_id",lower("name"));