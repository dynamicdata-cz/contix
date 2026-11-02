CREATE TABLE "policy_assets" (
	"policy_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "policy_assets_policy_id_asset_id_pk" PRIMARY KEY("policy_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "policy_processes" (
	"policy_id" uuid NOT NULL,
	"process_id" uuid NOT NULL,
	CONSTRAINT "policy_processes_policy_id_process_id_pk" PRIMARY KEY("policy_id","process_id")
);
--> statement-breakpoint
CREATE TABLE "policy_related" (
	"policy_id" uuid NOT NULL,
	"related_id" uuid NOT NULL,
	CONSTRAINT "policy_related_policy_id_related_id_pk" PRIMARY KEY("policy_id","related_id")
);
--> statement-breakpoint
CREATE TABLE "policy_requirements" (
	"policy_id" uuid NOT NULL,
	"requirement_id" varchar(100) NOT NULL,
	CONSTRAINT "policy_requirements_policy_id_requirement_id_pk" PRIMARY KEY("policy_id","requirement_id")
);
--> statement-breakpoint
CREATE TABLE "policy_risks" (
	"policy_id" uuid NOT NULL,
	"risk_id" uuid NOT NULL,
	CONSTRAINT "policy_risks_policy_id_risk_id_pk" PRIMARY KEY("policy_id","risk_id")
);
--> statement-breakpoint
CREATE TABLE "policy_suppliers" (
	"policy_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	CONSTRAINT "policy_suppliers_policy_id_supplier_id_pk" PRIMARY KEY("policy_id","supplier_id")
);
--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "policy_assets" ADD CONSTRAINT "policy_assets_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_assets" ADD CONSTRAINT "policy_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_processes" ADD CONSTRAINT "policy_processes_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_processes" ADD CONSTRAINT "policy_processes_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_related" ADD CONSTRAINT "policy_related_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_related" ADD CONSTRAINT "policy_related_related_id_policies_id_fk" FOREIGN KEY ("related_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_requirements" ADD CONSTRAINT "policy_requirements_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_risks" ADD CONSTRAINT "policy_risks_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_risks" ADD CONSTRAINT "policy_risks_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_suppliers" ADD CONSTRAINT "policy_suppliers_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_suppliers" ADD CONSTRAINT "policy_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "policy_assets_target_idx" ON "policy_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "policy_processes_target_idx" ON "policy_processes" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX "policy_related_target_idx" ON "policy_related" USING btree ("related_id");--> statement-breakpoint
CREATE INDEX "policy_req_req_idx" ON "policy_requirements" USING btree ("requirement_id");--> statement-breakpoint
CREATE INDEX "policy_risks_target_idx" ON "policy_risks" USING btree ("risk_id");--> statement-breakpoint
CREATE INDEX "policy_suppliers_target_idx" ON "policy_suppliers" USING btree ("supplier_id");--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_parent_id_policies_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."policies"("id") ON DELETE set null ON UPDATE no action;