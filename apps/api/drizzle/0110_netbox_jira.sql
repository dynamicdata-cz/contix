ALTER TYPE "public"."discovery_connector" ADD VALUE 'netbox';--> statement-breakpoint
ALTER TYPE "public"."source_type" ADD VALUE 'netbox';--> statement-breakpoint
CREATE TABLE "external_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"entity_type" varchar(30) NOT NULL,
	"entity_id" uuid NOT NULL,
	"issue_key" varchar(60) NOT NULL,
	"issue_url" varchar(1000) NOT NULL,
	"status" varchar(100),
	"last_sync_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_issues" ADD CONSTRAINT "external_issues_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_issues" ADD CONSTRAINT "external_issues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_issues" ADD CONSTRAINT "external_issues_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_issues_entity_uq" ON "external_issues" USING btree ("connection_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "external_issues_entity_idx" ON "external_issues" USING btree ("entity_type","entity_id");