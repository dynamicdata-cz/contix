CREATE TABLE "ai_system_activities" (
	"system_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	CONSTRAINT "ai_system_activities_system_id_activity_id_pk" PRIMARY KEY("system_id","activity_id")
);
--> statement-breakpoint
CREATE TABLE "ai_system_assets" (
	"system_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "ai_system_assets_system_id_asset_id_pk" PRIMARY KEY("system_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "ai_system_processes" (
	"system_id" uuid NOT NULL,
	"process_id" uuid NOT NULL,
	CONSTRAINT "ai_system_processes_system_id_process_id_pk" PRIMARY KEY("system_id","process_id")
);
--> statement-breakpoint
CREATE TABLE "ai_system_suppliers" (
	"system_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	CONSTRAINT "ai_system_suppliers_system_id_supplier_id_pk" PRIMARY KEY("system_id","supplier_id")
);
--> statement-breakpoint
CREATE TABLE "ai_systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"code" varchar(50),
	"name" varchar(300) NOT NULL,
	"vendor" varchar(300),
	"model" varchar(300),
	"role" varchar(30) DEFAULT 'deployer' NOT NULL,
	"source" varchar(20) DEFAULT 'saas' NOT NULL,
	"status" varchar(20) DEFAULT 'proposed' NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"description" text,
	"users" text,
	"input_data" text,
	"outputs" text,
	"human_oversight" text,
	"data_location" varchar(500),
	"instructions_url" text,
	"log_retention_months" smallint,
	"owner_position_id" uuid,
	"oversight_position_id" uuid,
	"screening" jsonb,
	"screened_at" timestamp with time zone,
	"obligations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fria" jsonb,
	"fria_status" varchar(20),
	"fria_approved_at" timestamp with time zone,
	"fria_approved_by_id" uuid,
	"decided_at" timestamp with time zone,
	"decided_by_id" uuid,
	"decision_note" text,
	"review_months" smallint DEFAULT 12 NOT NULL,
	"last_reviewed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_system_activities" ADD CONSTRAINT "ai_system_activities_system_id_ai_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."ai_systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_system_activities" ADD CONSTRAINT "ai_system_activities_activity_id_processing_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."processing_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_system_assets" ADD CONSTRAINT "ai_system_assets_system_id_ai_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."ai_systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_system_assets" ADD CONSTRAINT "ai_system_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_system_processes" ADD CONSTRAINT "ai_system_processes_system_id_ai_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."ai_systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_system_processes" ADD CONSTRAINT "ai_system_processes_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_system_suppliers" ADD CONSTRAINT "ai_system_suppliers_system_id_ai_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."ai_systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_system_suppliers" ADD CONSTRAINT "ai_system_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_systems" ADD CONSTRAINT "ai_systems_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_systems" ADD CONSTRAINT "ai_systems_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_systems" ADD CONSTRAINT "ai_systems_oversight_position_id_positions_id_fk" FOREIGN KEY ("oversight_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_systems" ADD CONSTRAINT "ai_systems_fria_approved_by_id_users_id_fk" FOREIGN KEY ("fria_approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_systems" ADD CONSTRAINT "ai_systems_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_systems_company_idx" ON "ai_systems" USING btree ("company_id");