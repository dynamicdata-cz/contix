DROP INDEX "agents_host_uq";--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_host_uq" ON "agents" USING btree ("connection_id","host_id") WHERE retired_at is null;