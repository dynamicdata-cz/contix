ALTER TYPE "public"."source_type" ADD VALUE 'agent';--> statement-breakpoint
ALTER TABLE "agent_events" ADD COLUMN "processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "state" jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "inventory_id" uuid;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_inventory_id_host_inventories_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."host_inventories"("id") ON DELETE set null ON UPDATE no action;