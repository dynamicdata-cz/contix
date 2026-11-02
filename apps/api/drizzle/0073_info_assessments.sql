CREATE TABLE "info_assessment_assets" (
	"assessment_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "info_assessment_assets_assessment_id_asset_id_pk" PRIMARY KEY("assessment_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "info_assessment_links" (
	"assessment_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "info_assessment_links_assessment_id_kind_target_id_pk" PRIMARY KEY("assessment_id","kind","target_id")
);
--> statement-breakpoint
ALTER TABLE "info_item_reviews" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "info_item_reviews" ADD CONSTRAINT "info_item_reviews_id_unique" UNIQUE("id");--> statement-breakpoint
ALTER TABLE "info_item_reviews" ADD COLUMN "status" varchar(20) DEFAULT 'resolved' NOT NULL;--> statement-breakpoint
ALTER TABLE "info_item_reviews" ADD COLUMN "owner_position_id" uuid;--> statement-breakpoint
ALTER TABLE "info_item_reviews" ADD COLUMN "due_date" date;--> statement-breakpoint
ALTER TABLE "info_assessment_assets" ADD CONSTRAINT "info_assessment_assets_assessment_id_info_item_reviews_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."info_item_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_assessment_assets" ADD CONSTRAINT "info_assessment_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_assessment_links" ADD CONSTRAINT "info_assessment_links_assessment_id_info_item_reviews_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."info_item_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "info_assessment_assets_asset_idx" ON "info_assessment_assets" USING btree ("asset_id");--> statement-breakpoint
ALTER TABLE "info_item_reviews" ADD CONSTRAINT "info_item_reviews_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;