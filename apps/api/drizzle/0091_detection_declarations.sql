CREATE TABLE "detection_declarations" (
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"technique" varchar(20) NOT NULL,
	"source" varchar(300) NOT NULL,
	"note" text,
	"declared_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "detection_declarations_company_id_technique_pk" PRIMARY KEY("company_id","technique")
);
--> statement-breakpoint
ALTER TABLE "detection_declarations" ADD CONSTRAINT "detection_declarations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detection_declarations" ADD CONSTRAINT "detection_declarations_declared_by_id_users_id_fk" FOREIGN KEY ("declared_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;