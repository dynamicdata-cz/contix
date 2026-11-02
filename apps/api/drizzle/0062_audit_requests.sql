CREATE TABLE "audit_auditors" (
	"audit_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_auditors_audit_id_user_id_pk" PRIMARY KEY("audit_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "audit_request_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid,
	"external" boolean DEFAULT false NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_request_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"mime" varchar(150) NOT NULL,
	"size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" "bytea" NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"uploaded_by_id" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"title" varchar(300) NOT NULL,
	"description" text,
	"reference" varchar(100),
	"owner_position_id" uuid,
	"due_date" date,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"submitted_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_auditors" ADD CONSTRAINT "audit_auditors_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_auditors" ADD CONSTRAINT "audit_auditors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_request_comments" ADD CONSTRAINT "audit_request_comments_request_id_audit_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."audit_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_request_comments" ADD CONSTRAINT "audit_request_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_request_files" ADD CONSTRAINT "audit_request_files_request_id_audit_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."audit_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_request_files" ADD CONSTRAINT "audit_request_files_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_requests" ADD CONSTRAINT "audit_requests_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_requests" ADD CONSTRAINT "audit_requests_owner_position_id_positions_id_fk" FOREIGN KEY ("owner_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_requests" ADD CONSTRAINT "audit_requests_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_auditors_user_idx" ON "audit_auditors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_request_comments_req_idx" ON "audit_request_comments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "audit_request_files_req_idx" ON "audit_request_files" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audit_requests_seq_uq" ON "audit_requests" USING btree ("audit_id","seq");--> statement-breakpoint
CREATE INDEX "audit_requests_owner_idx" ON "audit_requests" USING btree ("owner_position_id");