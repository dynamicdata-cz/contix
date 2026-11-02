CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"seq" serial NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"source_kind" varchar(30),
	"source_id" uuid,
	"owner_position_id" uuid,
	"due_date" date,
	"priority" varchar(10) DEFAULT 'medium' NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"completion_note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_source_idx" ON "tasks" USING btree ("source_kind","source_id");--> statement-breakpoint
CREATE INDEX "tasks_due_idx" ON "tasks" USING btree ("due_date");