ALTER TABLE "policies" ADD COLUMN "owner_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "owner_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_owner_unit_id_org_units_id_fk" FOREIGN KEY ("owner_unit_id") REFERENCES "public"."org_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- dokument patří útvaru svého gestora (funkční místo vlastníka), dokud ho někdo nezmění
UPDATE "policies" p SET "owner_unit_id" = pos."org_unit_id" FROM "positions" pos WHERE pos."id" = p."owner_position_id" AND p."owner_unit_id" IS NULL;
