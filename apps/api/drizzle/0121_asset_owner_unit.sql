ALTER TABLE "assets" ADD COLUMN "owner_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_owner_unit_idx" ON "assets" USING btree ("owner_unit_id");