CREATE TABLE "custom_frameworks" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"name" varchar(300) NOT NULL,
	"pack" jsonb NOT NULL,
	"requirement_count" integer DEFAULT 0 NOT NULL,
	"imported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_frameworks" ADD CONSTRAINT "custom_frameworks_imported_by_users_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;