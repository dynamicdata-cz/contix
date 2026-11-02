CREATE TABLE "policy_edit_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"mode" varchar(10) NOT NULL,
	"policy_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"revision_file_id" uuid,
	"user_id" uuid NOT NULL,
	"lock_token" varchar(100),
	"lock_expires_at" timestamp with time zone,
	"saves" smallint DEFAULT 0 NOT NULL,
	"last_saved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "policy_edit_sessions" ADD CONSTRAINT "policy_edit_sessions_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_edit_sessions" ADD CONSTRAINT "policy_edit_sessions_version_id_policy_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."policy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_edit_sessions" ADD CONSTRAINT "policy_edit_sessions_file_id_policy_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."policy_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_edit_sessions" ADD CONSTRAINT "policy_edit_sessions_revision_file_id_policy_files_id_fk" FOREIGN KEY ("revision_file_id") REFERENCES "public"."policy_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_edit_sessions" ADD CONSTRAINT "policy_edit_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_edit_sessions_token_uq" ON "policy_edit_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "policy_edit_sessions_version_idx" ON "policy_edit_sessions" USING btree ("version_id");