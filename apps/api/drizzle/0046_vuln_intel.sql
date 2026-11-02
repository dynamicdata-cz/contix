CREATE TABLE "vuln_intel" (
	"cve_id" varchar(30) PRIMARY KEY NOT NULL,
	"kev" boolean DEFAULT false NOT NULL,
	"kev_name" text,
	"kev_date_added" date,
	"kev_due_date" date,
	"kev_ransomware" boolean DEFAULT false NOT NULL,
	"epss" real,
	"epss_percentile" real,
	"epss_date" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
