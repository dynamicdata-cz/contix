ALTER TABLE "assets" ADD COLUMN "facility_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "physical" jsonb;--> statement-breakpoint
ALTER TABLE "security_zones" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "site_maps" ADD COLUMN "location_id" uuid;--> statement-breakpoint
ALTER TABLE "security_zones" ADD CONSTRAINT "security_zones_location_id_assets_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_maps" ADD CONSTRAINT "site_maps_location_id_assets_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;