CREATE TABLE "evidence_requirements" (
	"evidence_id" uuid NOT NULL,
	"requirement_id" varchar(100) NOT NULL,
	CONSTRAINT "evidence_requirements_evidence_id_requirement_id_pk" PRIMARY KEY("evidence_id","requirement_id")
);
--> statement-breakpoint
ALTER TABLE "evidence_requirements" ADD CONSTRAINT "evidence_requirements_evidence_id_evidence_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_req_req_idx" ON "evidence_requirements" USING btree ("requirement_id");