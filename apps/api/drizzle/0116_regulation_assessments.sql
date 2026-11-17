CREATE TABLE "regulation_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"subject_kind" varchar(20) NOT NULL,
	"subject_id" uuid NOT NULL,
	"ico" varchar(8),
	"staff" integer,
	"turnover_m_czk" double precision,
	"balance_m_czk" double precision,
	"eur_rate" double precision,
	"size_override" varchar(10),
	"size" varchar(10),
	"size_basis" varchar(10) DEFAULT 'none' NOT NULL,
	"linked_note" text DEFAULT '' NOT NULL,
	"services" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"regime" varchar(10) NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"res" jsonb,
	"applied" boolean DEFAULT false NOT NULL,
	"assessed_by_id" uuid,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "regulation_assessments" ADD CONSTRAINT "regulation_assessments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulation_assessments" ADD CONSTRAINT "regulation_assessments_assessed_by_id_users_id_fk" FOREIGN KEY ("assessed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "regulation_assessments_subject_idx" ON "regulation_assessments" USING btree ("subject_kind","subject_id","assessed_at");