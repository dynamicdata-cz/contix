CREATE TABLE "supplier_report_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"ref" varchar(100),
	"text" text NOT NULL,
	"criterion" varchar(50),
	"control_id" uuid,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"severity" varchar(10),
	"management_response" text,
	"note" text,
	"risk_id" uuid,
	"source" varchar(10) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"supplier_id" uuid NOT NULL,
	"kind" varchar(20) DEFAULT 'soc2_type2' NOT NULL,
	"title" varchar(300) NOT NULL,
	"service_auditor" varchar(300),
	"period_from" date,
	"period_to" date,
	"as_of" date,
	"opinion" varchar(20),
	"valid_until" date,
	"bridge_until" date,
	"subservice_orgs" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"file_name" varchar(255),
	"file_mime" varchar(100),
	"file_size" integer,
	"file_sha256" varchar(64),
	"file_content" "bytea",
	"text" text,
	"reviewed_by_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_report_items" ADD CONSTRAINT "supplier_report_items_report_id_supplier_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."supplier_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_report_items" ADD CONSTRAINT "supplier_report_items_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_report_items" ADD CONSTRAINT "supplier_report_items_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_reports" ADD CONSTRAINT "supplier_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_reports" ADD CONSTRAINT "supplier_reports_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_reports" ADD CONSTRAINT "supplier_reports_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_reports" ADD CONSTRAINT "supplier_reports_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_report_items_report_idx" ON "supplier_report_items" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "supplier_report_items_control_idx" ON "supplier_report_items" USING btree ("control_id");--> statement-breakpoint
CREATE INDEX "supplier_reports_supplier_idx" ON "supplier_reports" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_reports_company_idx" ON "supplier_reports" USING btree ("company_id","valid_until");