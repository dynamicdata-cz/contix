CREATE TABLE "exercise_plans" (
	"exercise_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_test_id" uuid,
	CONSTRAINT "exercise_plans_exercise_id_plan_id_pk" PRIMARY KEY("exercise_id","plan_id")
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"seq" serial NOT NULL,
	"title" varchar(300) NOT NULL,
	"exercise_type" "plan_test_type" DEFAULT 'tabletop' NOT NULL,
	"scenario_key" varchar(40),
	"scenario" text DEFAULT '' NOT NULL,
	"objectives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"injects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"planned_at" date,
	"facilitator_position_id" uuid,
	"status" varchar(20) DEFAULT 'planned' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" "plan_test_result",
	"achieved_rto_hours" real,
	"findings" text DEFAULT '' NOT NULL,
	"lessons" text DEFAULT '' NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise_plans" ADD CONSTRAINT "exercise_plans_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_plans" ADD CONSTRAINT "exercise_plans_plan_id_continuity_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."continuity_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_plans" ADD CONSTRAINT "exercise_plans_plan_test_id_plan_tests_id_fk" FOREIGN KEY ("plan_test_id") REFERENCES "public"."plan_tests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_facilitator_position_id_positions_id_fk" FOREIGN KEY ("facilitator_position_id") REFERENCES "public"."positions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercises_company_idx" ON "exercises" USING btree ("company_id","status");