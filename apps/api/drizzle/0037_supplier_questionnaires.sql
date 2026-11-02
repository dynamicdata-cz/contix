CREATE TABLE "supplier_questionnaires" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"supplier_id" uuid NOT NULL,
	"title" varchar(300) NOT NULL,
	"template" varchar(10) DEFAULT 'cz409' NOT NULL,
	"locale" varchar(5) DEFAULT 'cs' NOT NULL,
	"status" varchar(20) DEFAULT 'sent' NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_to" varchar(200),
	"message" text,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"respondent_name" varchar(200),
	"respondent_email" varchar(200),
	"respondent_role" varchar(200),
	"general_note" text,
	"last_saved_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"evaluated_at" timestamp with time zone,
	"evaluated_by_id" uuid,
	"evaluation_note" text,
	"risk_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_questionnaires" ADD CONSTRAINT "supplier_questionnaires_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_questionnaires" ADD CONSTRAINT "supplier_questionnaires_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_questionnaires" ADD CONSTRAINT "supplier_questionnaires_evaluated_by_id_users_id_fk" FOREIGN KEY ("evaluated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_questionnaires" ADD CONSTRAINT "supplier_questionnaires_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_questionnaires" ADD CONSTRAINT "supplier_questionnaires_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_questionnaires_token_uq" ON "supplier_questionnaires" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "supplier_questionnaires_supplier_idx" ON "supplier_questionnaires" USING btree ("supplier_id");