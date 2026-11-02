CREATE TABLE "kri_settings" (
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"key" varchar(40) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"warn" real,
	"alert" real,
	"breached_since" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kri_settings_company_id_key_pk" PRIMARY KEY("company_id","key")
);
--> statement-breakpoint
CREATE TABLE "risk_appetite" (
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"category" varchar(30) NOT NULL,
	"max_level" varchar(20) NOT NULL,
	"statement" text,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_appetite_company_id_category_pk" PRIMARY KEY("company_id","category")
);
--> statement-breakpoint
CREATE TABLE "risk_appetite_approvals" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "kri_settings" ADD CONSTRAINT "kri_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_appetite" ADD CONSTRAINT "risk_appetite_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_appetite" ADD CONSTRAINT "risk_appetite_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_appetite_approvals" ADD CONSTRAINT "risk_appetite_approvals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_appetite_approvals" ADD CONSTRAINT "risk_appetite_approvals_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;