CREATE TYPE "public"."control_automation_kind" AS ENUM('identity_checks', 'access_review');--> statement-breakpoint
CREATE TABLE "control_automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"control_id" uuid NOT NULL,
	"kind" "control_automation_kind" NOT NULL,
	"frequency" varchar(20) DEFAULT 'monthly' NOT NULL,
	"source_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"rules" text[] DEFAULT '{}'::text[] NOT NULL,
	"max_critical" integer DEFAULT 0 NOT NULL,
	"max_high" integer DEFAULT 0 NOT NULL,
	"apply_effectiveness" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_result" varchar(40),
	"last_test_id" uuid,
	"last_error" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity_sources" ADD COLUMN "provisioning" jsonb;--> statement-breakpoint
ALTER TABLE "org_units" ADD COLUMN "directory_source_id" uuid;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "directory_source_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "directory_source_id" uuid;--> statement-breakpoint
ALTER TABLE "control_automations" ADD CONSTRAINT "control_automations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_automations" ADD CONSTRAINT "control_automations_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_automations" ADD CONSTRAINT "control_automations_last_test_id_control_tests_id_fk" FOREIGN KEY ("last_test_id") REFERENCES "public"."control_tests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control_automations" ADD CONSTRAINT "control_automations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_units" ADD CONSTRAINT "org_units_directory_source_id_identity_sources_id_fk" FOREIGN KEY ("directory_source_id") REFERENCES "public"."identity_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_directory_source_id_identity_sources_id_fk" FOREIGN KEY ("directory_source_id") REFERENCES "public"."identity_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_directory_source_id_identity_sources_id_fk" FOREIGN KEY ("directory_source_id") REFERENCES "public"."identity_sources"("id") ON DELETE set null ON UPDATE no action;