CREATE TABLE "host_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"inventory_id" uuid NOT NULL,
	"asset_id" uuid,
	"key" varchar(64) NOT NULL,
	"code" varchar(60) NOT NULL,
	"severity" varchar(10) NOT NULL,
	"subject" varchar(500),
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"note" text,
	"accepted_by_id" uuid,
	"accepted_at" timestamp with time zone,
	"accepted_until" date,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fixed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "regulation_registrations" ADD COLUMN "responsible_position_id" uuid;--> statement-breakpoint
ALTER TABLE "host_findings" ADD CONSTRAINT "host_findings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_findings" ADD CONSTRAINT "host_findings_inventory_id_host_inventories_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."host_inventories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_findings" ADD CONSTRAINT "host_findings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_findings" ADD CONSTRAINT "host_findings_accepted_by_id_users_id_fk" FOREIGN KEY ("accepted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "host_findings_key_uq" ON "host_findings" USING btree ("inventory_id","key");--> statement-breakpoint
CREATE INDEX "host_findings_asset_idx" ON "host_findings" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "host_findings_company_idx" ON "host_findings" USING btree ("company_id","status");--> statement-breakpoint
ALTER TABLE "regulation_registrations" ADD CONSTRAINT "regulation_registrations_responsible_position_id_positions_id_fk" FOREIGN KEY ("responsible_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "regulation_registrations" r SET "responsible_position_id" = (r."data"->>'responsiblePositionId')::uuid WHERE r."data"->>'responsiblePositionId' ~ '^[0-9a-f-]{36}$' AND EXISTS (SELECT 1 FROM "positions" p WHERE p."id" = (r."data"->>'responsiblePositionId')::uuid);
