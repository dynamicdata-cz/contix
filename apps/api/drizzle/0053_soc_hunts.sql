CREATE TABLE "soc_hunts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(200) NOT NULL,
	"hypothesis" text DEFAULT '' NOT NULL,
	"query" text NOT NULL,
	"group_by" varchar(100) DEFAULT 'agent.id' NOT NULL,
	"threshold" integer DEFAULT 1 NOT NULL,
	"interval_hours" integer DEFAULT 24 NOT NULL,
	"lookback_hours" integer DEFAULT 24 NOT NULL,
	"severity" varchar(10) DEFAULT 'medium' NOT NULL,
	"mitre_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"template_key" varchar(40),
	"last_run" jsonb,
	"window_end" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "soc_hunts" ADD CONSTRAINT "soc_hunts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_hunts" ADD CONSTRAINT "soc_hunts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "soc_hunts_company_idx" ON "soc_hunts" USING btree ("company_id");