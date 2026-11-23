ALTER TABLE "regulation_registrations" ADD COLUMN "decision_delivered_at" date;--> statement-breakpoint
ALTER TABLE "regulation_registrations" ADD COLUMN "decision_ref" varchar(200);--> statement-breakpoint
ALTER TABLE "regulation_registrations" ADD COLUMN "decision_file_name" varchar(255);--> statement-breakpoint
ALTER TABLE "regulation_registrations" ADD COLUMN "decision_file_size" integer;--> statement-breakpoint
ALTER TABLE "regulation_registrations" ADD COLUMN "decision_file_sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "regulation_registrations" ADD COLUMN "decision_file" "bytea";