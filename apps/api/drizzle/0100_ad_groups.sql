CREATE TABLE "identity_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"dn" text NOT NULL,
	"cn" varchar(300) NOT NULL,
	"description" text,
	"privileged" boolean DEFAULT false NOT NULL,
	"protected_group" boolean DEFAULT false NOT NULL,
	"members" integer DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "iam_resources" ADD COLUMN "ad_create" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "identity_groups" ADD CONSTRAINT "identity_groups_source_id_identity_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."identity_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_groups" ADD CONSTRAINT "identity_groups_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identity_groups_dn_uq" ON "identity_groups" USING btree ("source_id",lower("dn"));--> statement-breakpoint
CREATE INDEX "identity_groups_company_idx" ON "identity_groups" USING btree ("company_id");