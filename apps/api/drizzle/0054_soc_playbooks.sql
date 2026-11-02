CREATE TABLE "soc_playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"techniques" text[] DEFAULT '{}'::text[] NOT NULL,
	"tactics" text[] DEFAULT '{}'::text[] NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"based_on" varchar(40),
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "source_step" smallint;--> statement-breakpoint
ALTER TABLE "soc_playbooks" ADD CONSTRAINT "soc_playbooks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_playbooks" ADD CONSTRAINT "soc_playbooks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "soc_playbooks_company_idx" ON "soc_playbooks" USING btree ("company_id");