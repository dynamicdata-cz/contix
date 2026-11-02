CREATE TABLE "answer_library" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"question" text NOT NULL,
	"question_key" varchar(500) NOT NULL,
	"answer" varchar(10),
	"answer_text" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage" integer DEFAULT 0 NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_questionnaire_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"questionnaire_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"source_row" integer,
	"ref" varchar(100),
	"section" varchar(300),
	"question" text NOT NULL,
	"answer" varchar(10),
	"answer_text" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(10) DEFAULT 'empty' NOT NULL,
	"confidence" varchar(10),
	"answered_by" varchar(10),
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_questionnaires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"customer" varchar(200) NOT NULL,
	"title" varchar(300) NOT NULL,
	"due_date" date,
	"status" varchar(20) DEFAULT 'in_progress' NOT NULL,
	"file_name" varchar(255),
	"file_content" "bytea",
	"sheet" varchar(100),
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trust_access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trust_center_id" uuid NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"name" varchar(200) NOT NULL,
	"email" varchar(200) NOT NULL,
	"organization" varchar(200) NOT NULL,
	"reason" text,
	"nda_accepted_at" timestamp with time zone NOT NULL,
	"ip" varchar(64),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"token_hash" varchar(64),
	"expires_at" timestamp with time zone,
	"decided_by_id" uuid,
	"decided_at" timestamp with time zone,
	"downloads" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_access_requests_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "trust_centers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"slug" varchar(50) NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_centers_company_id_unique" UNIQUE("company_id"),
	CONSTRAINT "trust_centers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "answer_library" ADD CONSTRAINT "answer_library_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_library" ADD CONSTRAINT "answer_library_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_questionnaire_items" ADD CONSTRAINT "customer_questionnaire_items_questionnaire_id_customer_questionnaires_id_fk" FOREIGN KEY ("questionnaire_id") REFERENCES "public"."customer_questionnaires"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_questionnaire_items" ADD CONSTRAINT "customer_questionnaire_items_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_questionnaires" ADD CONSTRAINT "customer_questionnaires_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_questionnaires" ADD CONSTRAINT "customer_questionnaires_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_questionnaires" ADD CONSTRAINT "customer_questionnaires_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_access_requests" ADD CONSTRAINT "trust_access_requests_trust_center_id_trust_centers_id_fk" FOREIGN KEY ("trust_center_id") REFERENCES "public"."trust_centers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_access_requests" ADD CONSTRAINT "trust_access_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_access_requests" ADD CONSTRAINT "trust_access_requests_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_centers" ADD CONSTRAINT "trust_centers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_centers" ADD CONSTRAINT "trust_centers_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_library_key_uq" ON "answer_library" USING btree ("company_id","question_key");--> statement-breakpoint
CREATE INDEX "customer_q_items_q_idx" ON "customer_questionnaire_items" USING btree ("questionnaire_id","seq");--> statement-breakpoint
CREATE INDEX "customer_q_company_idx" ON "customer_questionnaires" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "trust_requests_tc_idx" ON "trust_access_requests" USING btree ("trust_center_id","status");--> statement-breakpoint
CREATE INDEX "trust_requests_email_idx" ON "trust_access_requests" USING btree ("email");