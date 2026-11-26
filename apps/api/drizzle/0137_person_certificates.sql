CREATE TABLE "person_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"user_id" uuid,
	"person_id" uuid,
	"holder_name" varchar(200),
	"supplier_id" uuid,
	"name" varchar(300) NOT NULL,
	"kind" varchar(20) DEFAULT 'certification' NOT NULL,
	"issuer" varchar(200) DEFAULT '' NOT NULL,
	"credential_id" varchar(200) DEFAULT '' NOT NULL,
	"issued_at" date,
	"valid_until" date,
	"course_id" uuid,
	"training_record_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"file_name" varchar(255),
	"file_mime" varchar(100),
	"file_size" integer,
	"file_sha256" varchar(64),
	"file_content" "bytea",
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "person_certificates" ADD CONSTRAINT "person_certificates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_certificates" ADD CONSTRAINT "person_certificates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_certificates" ADD CONSTRAINT "person_certificates_person_id_iam_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."iam_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_certificates" ADD CONSTRAINT "person_certificates_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_certificates" ADD CONSTRAINT "person_certificates_course_id_training_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."training_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_certificates" ADD CONSTRAINT "person_certificates_training_record_id_training_records_id_fk" FOREIGN KEY ("training_record_id") REFERENCES "public"."training_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_certificates" ADD CONSTRAINT "person_certificates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_certificates_company_idx" ON "person_certificates" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "person_certificates_valid_idx" ON "person_certificates" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "person_certificates_user_idx" ON "person_certificates" USING btree ("user_id");