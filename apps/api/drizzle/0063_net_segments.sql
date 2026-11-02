CREATE TABLE "net_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"segment_id" uuid NOT NULL,
	"host_key" varchar(80) NOT NULL,
	"ip" varchar(45),
	"mac" varchar(17),
	"hostname" varchar(255),
	"vendor" varchar(255),
	"os_name" varchar(255),
	"open_ports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'unknown' NOT NULL,
	"asset_id" uuid,
	"alert_id" uuid,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_count" integer DEFAULT 1 NOT NULL,
	"note" varchar(1000),
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "net_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(200) NOT NULL,
	"cidrs" text[] DEFAULT '{}'::text[] NOT NULL,
	"exclude" text[] DEFAULT '{}'::text[] NOT NULL,
	"profile" varchar(20) DEFAULT 'ping' NOT NULL,
	"mode" varchar(20) DEFAULT 'monitor' NOT NULL,
	"schedule" varchar(20) DEFAULT 'manual' NOT NULL,
	"schedule_time" varchar(5) DEFAULT '02:00' NOT NULL,
	"schedule_weekday" smallint DEFAULT 1 NOT NULL,
	"alert_level" smallint DEFAULT 8 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"note" varchar(1000),
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"last_run_id" uuid,
	"last_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "net_observations" ADD CONSTRAINT "net_observations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_observations" ADD CONSTRAINT "net_observations_segment_id_net_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."net_segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_observations" ADD CONSTRAINT "net_observations_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_observations" ADD CONSTRAINT "net_observations_alert_id_alert_suggestions_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alert_suggestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_observations" ADD CONSTRAINT "net_observations_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_segments" ADD CONSTRAINT "net_segments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "net_observations_uq" ON "net_observations" USING btree ("segment_id","host_key");--> statement-breakpoint
CREATE INDEX "net_observations_status_idx" ON "net_observations" USING btree ("status");