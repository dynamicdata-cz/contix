CREATE TABLE "knowledge_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"title" varchar(300) NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "record_vectors" ADD COLUMN "excluded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "record_vectors" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_articles_company_idx" ON "knowledge_articles" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "record_vectors_tsv_idx" ON "record_vectors" USING gin ("search_tsv");