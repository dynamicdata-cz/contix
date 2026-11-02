CREATE TABLE "cra_product_assets" (
	"product_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "cra_product_assets_product_id_asset_id_pk" PRIMARY KEY("product_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "cra_product_processes" (
	"product_id" uuid NOT NULL,
	"process_id" uuid NOT NULL,
	CONSTRAINT "cra_product_processes_product_id_process_id_pk" PRIMARY KEY("product_id","process_id")
);
--> statement-breakpoint
CREATE TABLE "cra_product_risks" (
	"product_id" uuid NOT NULL,
	"risk_id" uuid NOT NULL,
	CONSTRAINT "cra_product_risks_product_id_risk_id_pk" PRIMARY KEY("product_id","risk_id")
);
--> statement-breakpoint
CREATE TABLE "cra_product_suppliers" (
	"product_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	CONSTRAINT "cra_product_suppliers_product_id_supplier_id_pk" PRIMARY KEY("product_id","supplier_id")
);
--> statement-breakpoint
ALTER TABLE "audit_findings" ADD COLUMN "control_id" uuid;--> statement-breakpoint
ALTER TABLE "cra_findings" ADD COLUMN "risk_id" uuid;--> statement-breakpoint
ALTER TABLE "cra_product_assets" ADD CONSTRAINT "cra_product_assets_product_id_cra_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."cra_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cra_product_assets" ADD CONSTRAINT "cra_product_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cra_product_processes" ADD CONSTRAINT "cra_product_processes_product_id_cra_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."cra_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cra_product_processes" ADD CONSTRAINT "cra_product_processes_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cra_product_risks" ADD CONSTRAINT "cra_product_risks_product_id_cra_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."cra_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cra_product_risks" ADD CONSTRAINT "cra_product_risks_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cra_product_suppliers" ADD CONSTRAINT "cra_product_suppliers_product_id_cra_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."cra_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cra_product_suppliers" ADD CONSTRAINT "cra_product_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cra_product_assets_target_idx" ON "cra_product_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "cra_product_processes_target_idx" ON "cra_product_processes" USING btree ("process_id");--> statement-breakpoint
CREATE INDEX "cra_product_risks_target_idx" ON "cra_product_risks" USING btree ("risk_id");--> statement-breakpoint
CREATE INDEX "cra_product_suppliers_target_idx" ON "cra_product_suppliers" USING btree ("supplier_id");--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cra_findings" ADD CONSTRAINT "cra_findings_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE set null ON UPDATE no action;