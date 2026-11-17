ALTER TYPE "public"."asset_type" ADD VALUE 'network_socket' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."asset_type" ADD VALUE 'rack' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "map_placements" (
	"map_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "map_placements_map_id_asset_id_pk" PRIMARY KEY("map_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "site_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(200) NOT NULL,
	"site" varchar(200),
	"building" varchar(200),
	"floor" varchar(100),
	"file_name" varchar(255) NOT NULL,
	"file_mime" varchar(100) NOT NULL,
	"file_sha256" varchar(64) NOT NULL,
	"original" "bytea" NOT NULL,
	"image" "bytea" NOT NULL,
	"image_mime" varchar(50) NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "map_placements" ADD CONSTRAINT "map_placements_map_id_site_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."site_maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_placements" ADD CONSTRAINT "map_placements_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_maps" ADD CONSTRAINT "site_maps_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_maps" ADD CONSTRAINT "site_maps_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "map_placements_asset_idx" ON "map_placements" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "site_maps_company_idx" ON "site_maps" USING btree ("company_id");