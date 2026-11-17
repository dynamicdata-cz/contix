ALTER TABLE "sec_test_findings" ADD COLUMN "accepted_by_id" uuid;--> statement-breakpoint
ALTER TABLE "sec_test_findings" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sec_test_findings" ADD COLUMN "accepted_until" date;--> statement-breakpoint
ALTER TABLE "sec_test_findings" ADD CONSTRAINT "sec_test_findings_accepted_by_id_users_id_fk" FOREIGN KEY ("accepted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;