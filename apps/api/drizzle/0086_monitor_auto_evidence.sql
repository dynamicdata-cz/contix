ALTER TABLE "control_monitors" ADD COLUMN "auto_task" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "control_monitors" ADD COLUMN "open_task_id" uuid;--> statement-breakpoint
ALTER TABLE "control_monitors" ADD COLUMN "token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "control_monitors" ADD CONSTRAINT "control_monitors_open_task_id_tasks_id_fk" FOREIGN KEY ("open_task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;