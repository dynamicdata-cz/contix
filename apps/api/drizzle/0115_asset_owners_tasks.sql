ALTER TABLE "assets" ADD COLUMN "technical_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "technical_deputy_user_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD COLUMN "asset_id" uuid;--> statement-breakpoint
ALTER TABLE "sec_test_batches" ADD COLUMN "auto_tasks" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_technical_owner_user_id_users_id_fk" FOREIGN KEY ("technical_owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_technical_deputy_user_id_users_id_fk" FOREIGN KEY ("technical_deputy_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_tech_owner_idx" ON "assets" USING btree ("technical_owner_user_id");