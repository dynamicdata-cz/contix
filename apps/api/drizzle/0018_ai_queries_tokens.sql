CREATE TABLE "ai_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"user_id" uuid NOT NULL,
	"question" text NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answer" text,
	"provider" varchar(20),
	"model" varchar(200),
	"error" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"prefix" varchar(16) NOT NULL,
	"company_id" uuid,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "asset_duplicate_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"asset_a" uuid NOT NULL,
	"asset_b" uuid NOT NULL,
	"dismissed_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_queries" ADD CONSTRAINT "ai_queries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_queries" ADD CONSTRAINT "ai_queries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_duplicate_dismissals" ADD CONSTRAINT "asset_duplicate_dismissals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_duplicate_dismissals" ADD CONSTRAINT "asset_duplicate_dismissals_asset_a_assets_id_fk" FOREIGN KEY ("asset_a") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_duplicate_dismissals" ADD CONSTRAINT "asset_duplicate_dismissals_asset_b_assets_id_fk" FOREIGN KEY ("asset_b") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_duplicate_dismissals" ADD CONSTRAINT "asset_duplicate_dismissals_dismissed_by_id_users_id_fk" FOREIGN KEY ("dismissed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_queries_user_idx" ON "ai_queries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_dup_pair_uq" ON "asset_duplicate_dismissals" USING btree ("asset_a","asset_b");