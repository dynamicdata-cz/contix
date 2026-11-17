CREATE TABLE "guide_owners" (
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"guide_id" varchar(40) NOT NULL,
	"position_id" uuid NOT NULL,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_owners_company_id_guide_id_pk" PRIMARY KEY("company_id","guide_id")
);
--> statement-breakpoint
ALTER TABLE "guide_owners" ADD CONSTRAINT "guide_owners_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_owners" ADD CONSTRAINT "guide_owners_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_owners" ADD CONSTRAINT "guide_owners_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;