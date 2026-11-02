CREATE TABLE "threat_intel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" varchar(40) NOT NULL,
	"type" varchar(10) NOT NULL,
	"value" varchar(2000) NOT NULL,
	"threat" varchar(200),
	"confidence" smallint,
	"first_seen" timestamp with time zone,
	"reference" varchar(500),
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_suggestions" ADD COLUMN "intel" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "threat_intel_uq" ON "threat_intel" USING btree ("source","type","value");--> statement-breakpoint
CREATE INDEX "threat_intel_value_idx" ON "threat_intel" USING btree ("type","value");