ALTER TABLE "leave_types" ADD COLUMN "delays_increment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Extraordinary leave does not count for increment or probation (user request 2026-10-30, leave phase 4).
UPDATE "leave_types" SET "delays_increment" = true WHERE upper("short") = 'EOL' OR lower("name") = 'extraordinary leave';
