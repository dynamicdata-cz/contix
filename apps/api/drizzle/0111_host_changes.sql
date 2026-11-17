CREATE TABLE "host_inventory_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_id" uuid NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "host_inventory_changes" ADD CONSTRAINT "host_inventory_changes_inventory_id_host_inventories_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."host_inventories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "host_inventory_changes_inv_idx" ON "host_inventory_changes" USING btree ("inventory_id","collected_at");