CREATE TABLE "iam_provisioning" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"mode" varchar(20) DEFAULT 'off' NOT NULL,
	"source_id" uuid,
	"bind_dn" varchar(500) DEFAULT '' NOT NULL,
	"secret_enc" text,
	"allowed_ou" varchar(500) DEFAULT '' NOT NULL,
	"daily_limit" integer DEFAULT 50 NOT NULL,
	"extra_forbidden" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "iam_provisioning_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"request_id" uuid,
	"action" varchar(10) NOT NULL,
	"group_dn" text NOT NULL,
	"member" text NOT NULL,
	"ok" boolean NOT NULL,
	"message" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "iam_provisioning" ADD CONSTRAINT "iam_provisioning_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_provisioning" ADD CONSTRAINT "iam_provisioning_source_id_identity_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."identity_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_provisioning_log" ADD CONSTRAINT "iam_provisioning_log_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_provisioning_log" ADD CONSTRAINT "iam_provisioning_log_request_id_iam_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."iam_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "iam_provisioning_log" ADD CONSTRAINT "iam_provisioning_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "iam_prov_log_company_idx" ON "iam_provisioning_log" USING btree ("company_id","created_at");