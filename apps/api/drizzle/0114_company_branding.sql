CREATE TABLE "company_branding" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"logo" text,
	"logo_width" integer,
	"logo_height" integer,
	"accent_color" varchar(7),
	"footer_text" varchar(200) DEFAULT '' NOT NULL,
	"show_name" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_branding" ADD CONSTRAINT "company_branding_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;