CREATE TYPE "public"."identity_account_kind" AS ENUM('user', 'service', 'guest');--> statement-breakpoint
CREATE TYPE "public"."identity_finding_status" AS ENUM('open', 'accepted', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."identity_severity" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."identity_source_kind" AS ENUM('ad', 'entra');--> statement-breakpoint
CREATE TABLE "identity_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"external_id" varchar(200) NOT NULL,
	"login" varchar(300) NOT NULL,
	"display_name" varchar(300) DEFAULT '' NOT NULL,
	"email" varchar(320),
	"kind" "identity_account_kind" DEFAULT 'user' NOT NULL,
	"enabled" boolean NOT NULL,
	"privileged" boolean DEFAULT false NOT NULL,
	"privileged_via" text[] DEFAULT '{}'::text[] NOT NULL,
	"groups" text[] DEFAULT '{}'::text[] NOT NULL,
	"flags" jsonb NOT NULL,
	"mfa" boolean,
	"dn" text,
	"dir_created_at" timestamp with time zone,
	"last_logon_at" timestamp with time zone,
	"pwd_last_set_at" timestamp with time zone,
	"department" varchar(300),
	"title" varchar(300),
	"user_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"account_id" uuid,
	"subject" varchar(400) NOT NULL,
	"rule" varchar(50) NOT NULL,
	"severity" "identity_severity" NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"status" "identity_finding_status" DEFAULT 'open' NOT NULL,
	"accepted_by" uuid,
	"accepted_reason" text,
	"accepted_until" date,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"stats" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"kind" "identity_source_kind" NOT NULL,
	"name" varchar(200) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb NOT NULL,
	"secret_enc" text,
	"policy" jsonb NOT NULL,
	"sync_hours" integer DEFAULT 24 NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_status" varchar(20),
	"last_error" text,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stats" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity_accounts" ADD CONSTRAINT "identity_accounts_source_id_identity_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."identity_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_accounts" ADD CONSTRAINT "identity_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_accounts" ADD CONSTRAINT "identity_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_findings" ADD CONSTRAINT "identity_findings_source_id_identity_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."identity_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_findings" ADD CONSTRAINT "identity_findings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_findings" ADD CONSTRAINT "identity_findings_account_id_identity_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."identity_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_findings" ADD CONSTRAINT "identity_findings_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_snapshots" ADD CONSTRAINT "identity_snapshots_source_id_identity_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."identity_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_snapshots" ADD CONSTRAINT "identity_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_sources" ADD CONSTRAINT "identity_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_accounts_uq" ON "identity_accounts" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "identity_accounts_company_idx" ON "identity_accounts" USING btree ("company_id","privileged");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_findings_uq" ON "identity_findings" USING btree ("source_id","rule","subject");--> statement-breakpoint
CREATE INDEX "identity_findings_status_idx" ON "identity_findings" USING btree ("company_id","status","severity");