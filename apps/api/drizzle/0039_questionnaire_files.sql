CREATE TABLE "supplier_questionnaire_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"questionnaire_id" uuid NOT NULL,
	"question_key" varchar(60),
	"filename" varchar(255) NOT NULL,
	"mime" varchar(150) NOT NULL,
	"size" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"content" "bytea" NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_questionnaire_files" ADD CONSTRAINT "supplier_questionnaire_files_questionnaire_id_supplier_questionnaires_id_fk" FOREIGN KEY ("questionnaire_id") REFERENCES "public"."supplier_questionnaires"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_questionnaire_files_q_idx" ON "supplier_questionnaire_files" USING btree ("questionnaire_id");