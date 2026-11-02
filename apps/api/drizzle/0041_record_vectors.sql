CREATE TABLE "record_vectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"kind" varchar(20) NOT NULL,
	"ref_id" varchar(200) NOT NULL,
	"title" varchar(500) NOT NULL,
	"text" text NOT NULL,
	"search_text" text NOT NULL,
	"link" varchar(500) NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"embedding" vector,
	"model" varchar(200),
	"error" text,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "record_vectors" ADD CONSTRAINT "record_vectors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "record_vectors_ref_uq" ON "record_vectors" USING btree ("kind","ref_id");--> statement-breakpoint
CREATE INDEX "record_vectors_company_idx" ON "record_vectors" USING btree ("company_id");