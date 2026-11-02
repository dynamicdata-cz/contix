CREATE TABLE "ai_system_controls" (
	"system_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	CONSTRAINT "ai_system_controls_system_id_control_id_pk" PRIMARY KEY("system_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "ai_system_risks" (
	"system_id" uuid NOT NULL,
	"risk_id" uuid NOT NULL,
	CONSTRAINT "ai_system_risks_system_id_risk_id_pk" PRIMARY KEY("system_id","risk_id")
);
--> statement-breakpoint
CREATE TABLE "exception_controls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"kind" varchar(30) NOT NULL,
	"record_id" varchar(200) NOT NULL,
	"title" varchar(500) NOT NULL,
	"control_id" uuid NOT NULL,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_system_controls" ADD CONSTRAINT "ai_system_controls_system_id_ai_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."ai_systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_system_controls" ADD CONSTRAINT "ai_system_controls_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_system_risks" ADD CONSTRAINT "ai_system_risks_system_id_ai_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."ai_systems"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_system_risks" ADD CONSTRAINT "ai_system_risks_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_controls" ADD CONSTRAINT "exception_controls_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_controls" ADD CONSTRAINT "exception_controls_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_controls" ADD CONSTRAINT "exception_controls_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exception_controls_uq" ON "exception_controls" USING btree ("kind","record_id","control_id");--> statement-breakpoint
CREATE INDEX "exception_controls_control_idx" ON "exception_controls" USING btree ("control_id");