CREATE TYPE "public"."alert_suggestion_status" AS ENUM('new', 'accepted', 'dismissed');--> statement-breakpoint
CREATE TABLE "alert_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"source" varchar(20) DEFAULT 'wazuh' NOT NULL,
	"group_key" varchar(200) NOT NULL,
	"rule_id" varchar(50) NOT NULL,
	"rule_level" smallint NOT NULL,
	"description" text NOT NULL,
	"groups" text[] DEFAULT '{}'::text[] NOT NULL,
	"agent_id" varchar(50),
	"agent_name" varchar(255),
	"asset_id" uuid,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"status" "alert_suggestion_status" DEFAULT 'new' NOT NULL,
	"incident_id" uuid,
	"dismiss_reason" text,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"sample" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD CONSTRAINT "alert_suggestions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD CONSTRAINT "alert_suggestions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD CONSTRAINT "alert_suggestions_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD CONSTRAINT "alert_suggestions_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_suggestions_key_idx" ON "alert_suggestions" USING btree ("group_key","status");