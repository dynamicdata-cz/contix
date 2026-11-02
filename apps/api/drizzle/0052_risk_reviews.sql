CREATE TABLE "risk_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"risk_id" uuid NOT NULL,
	"decision" varchar(20) NOT NULL,
	"note" text,
	"triggers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"level_before" varchar(20),
	"level_after" varchar(20),
	"score_before" integer,
	"score_after" integer,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "risks" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "risk_reviews" ADD CONSTRAINT "risk_reviews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_reviews" ADD CONSTRAINT "risk_reviews_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_reviews" ADD CONSTRAINT "risk_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "risk_reviews_risk_idx" ON "risk_reviews" USING btree ("risk_id","created_at");