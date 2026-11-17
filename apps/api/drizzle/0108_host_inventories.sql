ALTER TYPE "public"."source_type" ADD VALUE 'collector';--> statement-breakpoint
CREATE TABLE "host_inventories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"asset_id" uuid,
	"host_key" varchar(255) NOT NULL,
	"hostname" varchar(255) NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "host_inventories" ADD CONSTRAINT "host_inventories_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_inventories" ADD CONSTRAINT "host_inventories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_inventories" ADD CONSTRAINT "host_inventories_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "host_inventories_host_uq" ON "host_inventories" USING btree ("connection_id","host_key");--> statement-breakpoint
CREATE INDEX "host_inventories_asset_idx" ON "host_inventories" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "host_inventories_company_idx" ON "host_inventories" USING btree ("company_id");