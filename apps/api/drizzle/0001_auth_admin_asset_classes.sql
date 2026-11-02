CREATE TYPE "public"."asset_class" AS ENUM('primary', 'supporting');--> statement-breakpoint
CREATE TYPE "public"."auth_provider" AS ENUM('local', 'oidc');--> statement-breakpoint
CREATE TYPE "public"."role_source" AS ENUM('manual', 'idp');--> statement-breakpoint
ALTER TYPE "public"."asset_type" ADD VALUE 'business_service';--> statement-breakpoint
ALTER TYPE "public"."asset_type" ADD VALUE 'business_process';--> statement-breakpoint
ALTER TYPE "public"."asset_type" ADD VALUE 'personnel';--> statement-breakpoint
ALTER TYPE "public"."asset_type" ADD VALUE 'supplier';--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_links" (
	"primary_id" uuid NOT NULL,
	"supporting_id" uuid NOT NULL,
	"note" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_links_primary_id_supporting_id_pk" PRIMARY KEY("primary_id","supporting_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"user_email" varchar(320),
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(50),
	"entity_id" varchar(100),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" varchar(100)
);
--> statement-breakpoint
CREATE TABLE "auth_flows" (
	"state" varchar(100) PRIMARY KEY NOT NULL,
	"provider" varchar(50) NOT NULL,
	"nonce" varchar(100) NOT NULL,
	"code_verifier" varchar(200) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "group_roles" (
	"group_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "group_roles_group_id_role_id_pk" PRIMARY KEY("group_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "mfa_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(50) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"external_groups" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"via_idp" boolean DEFAULT false NOT NULL,
	"ip" varchar(100),
	"user_agent" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"source" "role_source" DEFAULT 'manual' NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_source_pk" PRIMARY KEY("user_id","role_id","source")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"job_title" varchar(200),
	"auth_provider" "auth_provider" DEFAULT 'local' NOT NULL,
	"external_id" varchar(500),
	"password_hash" text,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"mfa_secret_enc" text,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_last_step" integer,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "asset_class" "asset_class" DEFAULT 'supporting' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_links" ADD CONSTRAINT "asset_links_primary_id_assets_id_fk" FOREIGN KEY ("primary_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_links" ADD CONSTRAINT "asset_links_supporting_id_assets_id_fk" FOREIGN KEY ("supporting_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_roles" ADD CONSTRAINT "group_roles_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_roles" ADD CONSTRAINT "group_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_links_supporting_idx" ON "asset_links" USING btree ("supporting_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_external_uq" ON "users" USING btree ("external_id");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_class_idx" ON "assets" USING btree ("asset_class");--> statement-breakpoint
CREATE INDEX "assets_owner_idx" ON "assets" USING btree ("owner_user_id");