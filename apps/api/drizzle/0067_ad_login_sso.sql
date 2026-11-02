ALTER TYPE "public"."auth_provider" ADD VALUE 'ad';--> statement-breakpoint
CREATE TABLE "sso_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(20) NOT NULL,
	"label" varchar(100) NOT NULL,
	"tenant_id" varchar(100) DEFAULT '' NOT NULL,
	"issuer" varchar(500) DEFAULT '' NOT NULL,
	"client_id" varchar(300) NOT NULL,
	"secret_enc" text,
	"scopes" varchar(300) DEFAULT 'openid profile email' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity_sources" ADD COLUMN "login" jsonb;