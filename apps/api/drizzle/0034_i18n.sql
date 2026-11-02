CREATE TABLE "language_packs" (
	"locale" varchar(20) PRIMARY KEY NOT NULL,
	"name" varchar(60) NOT NULL,
	"native_name" varchar(60) NOT NULL,
	"fallback" varchar(20),
	"messages" jsonb NOT NULL,
	"help" jsonb,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" varchar(20);--> statement-breakpoint
ALTER TABLE "language_packs" ADD CONSTRAINT "language_packs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;