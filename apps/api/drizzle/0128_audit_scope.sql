CREATE TABLE "audit_assets" (
	"audit_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "audit_assets_audit_id_asset_id_pk" PRIMARY KEY("audit_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "audit_controls" (
	"audit_id" uuid NOT NULL,
	"control_id" uuid NOT NULL,
	CONSTRAINT "audit_controls_audit_id_control_id_pk" PRIMARY KEY("audit_id","control_id")
);
--> statement-breakpoint
CREATE TABLE "audit_processes" (
	"audit_id" uuid NOT NULL,
	"process_id" uuid NOT NULL,
	CONSTRAINT "audit_processes_audit_id_process_id_pk" PRIMARY KEY("audit_id","process_id")
);
--> statement-breakpoint
ALTER TABLE "audit_assets" ADD CONSTRAINT "audit_assets_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_assets" ADD CONSTRAINT "audit_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_controls" ADD CONSTRAINT "audit_controls_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_controls" ADD CONSTRAINT "audit_controls_control_id_controls_id_fk" FOREIGN KEY ("control_id") REFERENCES "public"."controls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_processes" ADD CONSTRAINT "audit_processes_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_processes" ADD CONSTRAINT "audit_processes_process_id_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."processes"("id") ON DELETE cascade ON UPDATE no action;