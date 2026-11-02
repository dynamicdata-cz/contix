CREATE TABLE "doc_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"policy_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"source" varchar(255) NOT NULL,
	"ordinal" integer NOT NULL,
	"heading" varchar(300),
	"text" text NOT NULL,
	"search_text" text NOT NULL,
	"embedding" vector,
	"model" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_index_state" (
	"policy_id" uuid PRIMARY KEY NOT NULL,
	"version_id" uuid,
	"model" varchar(200),
	"chunks" integer DEFAULT 0 NOT NULL,
	"source_hash" varchar(64),
	"indexed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "doc_chunks" ADD CONSTRAINT "doc_chunks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_chunks" ADD CONSTRAINT "doc_chunks_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_chunks" ADD CONSTRAINT "doc_chunks_version_id_policy_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."policy_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_index_state" ADD CONSTRAINT "doc_index_state_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doc_chunks_policy_idx" ON "doc_chunks" USING btree ("policy_id");--> statement-breakpoint
CREATE INDEX "doc_chunks_company_idx" ON "doc_chunks" USING btree ("company_id");