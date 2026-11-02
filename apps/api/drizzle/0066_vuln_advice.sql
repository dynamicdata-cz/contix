CREATE TABLE "vuln_advice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"cve_id" varchar(30) NOT NULL,
	"locale" varchar(10) DEFAULT 'cs' NOT NULL,
	"content" jsonb NOT NULL,
	"model" varchar(200) DEFAULT '' NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vuln_advice" ADD CONSTRAINT "vuln_advice_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vuln_advice" ADD CONSTRAINT "vuln_advice_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vuln_advice_uq" ON "vuln_advice" USING btree ("company_id","cve_id","locale");