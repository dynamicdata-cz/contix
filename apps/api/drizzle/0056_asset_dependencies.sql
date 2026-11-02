CREATE TABLE "asset_dependencies" (
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"kind" varchar(20) DEFAULT 'uses' NOT NULL,
	"note" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_dependencies_from_id_to_id_pk" PRIMARY KEY("from_id","to_id")
);
--> statement-breakpoint
ALTER TABLE "asset_dependencies" ADD CONSTRAINT "asset_dependencies_from_id_assets_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_dependencies" ADD CONSTRAINT "asset_dependencies_to_id_assets_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asset_dependencies_to_idx" ON "asset_dependencies" USING btree ("to_id");