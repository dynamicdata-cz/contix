CREATE TYPE "public"."management_system" AS ENUM('isms', 'qms', 'ems', 'ohs', 'privacy', 'bcm', 'general');--> statement-breakpoint
ALTER TYPE "public"."policy_type" ADD VALUE 'form' BEFORE 'record';--> statement-breakpoint
ALTER TABLE "policies" ADD COLUMN "system" "management_system" DEFAULT 'isms' NOT NULL;