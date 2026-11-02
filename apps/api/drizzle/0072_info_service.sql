CREATE TABLE "info_feed_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_id" varchar(40) NOT NULL,
	"guid" varchar(500) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"title" varchar(500) NOT NULL,
	"link" varchar(1000) DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"category" varchar(200) DEFAULT '' NOT NULL,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "info_incident_stats" (
	"source" varchar(40) NOT NULL,
	"month" varchar(7) NOT NULL,
	"classification" varchar(100) NOT NULL,
	"severity" varchar(100) NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "info_incident_stats_source_month_classification_severity_pk" PRIMARY KEY("source","month","classification","severity")
);
--> statement-breakpoint
CREATE TABLE "info_item_reviews" (
	"item_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "info_item_reviews_item_id_company_id_pk" PRIMARY KEY("item_id","company_id")
);
--> statement-breakpoint
ALTER TABLE "info_item_reviews" ADD CONSTRAINT "info_item_reviews_item_id_info_feed_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."info_feed_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_item_reviews" ADD CONSTRAINT "info_item_reviews_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "info_item_reviews" ADD CONSTRAINT "info_item_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "info_feed_items_uq" ON "info_feed_items" USING btree ("feed_id","guid");--> statement-breakpoint
CREATE INDEX "info_feed_items_pub_idx" ON "info_feed_items" USING btree ("published_at");