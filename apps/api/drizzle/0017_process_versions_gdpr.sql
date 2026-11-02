CREATE TABLE "activity_assets" (
	"activity_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "activity_assets_activity_id_asset_id_pk" PRIMARY KEY("activity_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "activity_controls" (
	"activity_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	CONSTRAINT "activity_controls_activity_id_control_id_pk" PRIMARY KEY("activity_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "activity_processes" (
	"activity_id" uuid NOT NULL,
	"process_id" uuid NOT NULL,
	CONSTRAINT "activity_processes_activity_id_process_id_pk" PRIMARY KEY("activity_id","process_id")
);
--> statement-breakpoint
CREATE TABLE "activity_suppliers" (
	"activity_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	CONSTRAINT "activity_suppliers_activity_id_supplier_id_pk" PRIMARY KEY("activity_id","supplier_id")
);
--> statement-breakpoint
CREATE TABLE "dpias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activity_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"description" text,
	"necessity" text,
	"risks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dpo_opinion" text,
	"conclusion" text,
	"prior_consultation" boolean DEFAULT false NOT NULL,
	"next_review" date,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dpias_activity_id_unique" UNIQUE("activity_id")
);
--> statement-breakpoint
CREATE TABLE "process_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"process_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"change_summary" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by_id" uuid,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"code" varchar(50),
	"name" varchar(300) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"role" varchar(20) DEFAULT 'controller' NOT NULL,
	"purpose" text DEFAULT '' NOT NULL,
	"legal_basis" varchar(30),
	"legal_basis_note" text,
	"data_subjects" text[] DEFAULT '{}'::text[] NOT NULL,
	"data_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"special_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"recipients" text,
	"third_country_transfers" text,
	"retention" text,
	"security_measures" text,
	"owner_position_id" uuid,
	"dpia_criteria" text[] DEFAULT '{}'::text[] NOT NULL,
	"review_months" smallint DEFAULT 12 NOT NULL,
	"last_reviewed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity_assets" ADD CONSTRAINT "activity_assets_activity_id_processing_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."processing_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_assets" ADD CONSTRAINT "activity_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_controls" ADD CONSTRAINT "activity_controls_activity_id_processing_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."processing_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_controls" ADD CONSTRAINT "activity_controls_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_processes" ADD CONSTRAINT "activity_processes_activity_id_processing_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."processing_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_processes" ADD CONSTRAINT "activity_processes_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_suppliers" ADD CONSTRAINT "activity_suppliers_activity_id_processing_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."processing_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_suppliers" ADD CONSTRAINT "activity_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpias" ADD CONSTRAINT "dpias_activity_id_processing_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."processing_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dpias" ADD CONSTRAINT "dpias_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_versions" ADD CONSTRAINT "process_versions_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_versions" ADD CONSTRAINT "process_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "process_versions" ADD CONSTRAINT "process_versions_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activities" ADD CONSTRAINT "processing_activities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_activities" ADD CONSTRAINT "processing_activities_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "process_versions_uq" ON "process_versions" USING btree ("process_id","number");--> statement-breakpoint
CREATE INDEX "processing_activities_company_idx" ON "processing_activities" USING btree ("company_id");