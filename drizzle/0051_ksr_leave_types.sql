ALTER TABLE "employee_leaves" ADD COLUMN "on_medical" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD COLUMN "terminal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "ksr_key" text;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "rule" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "at_once" numeric(6, 1);--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "non_medical_at_once" numeric(6, 1);--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "non_medical_limit" numeric(6, 1);--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "spell_limit" numeric(6, 1);--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "last_resort" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "surrender_per_year" numeric(6, 1);--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "terminal_surrender" numeric(6, 1);--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_ksr" ON "leave_types" USING btree ("user_id","ksr_key");--> statement-breakpoint
-- The leave types "Add the usual leaves" made become the built-in KSR types (same name); the rest are added by the app.
UPDATE "leave_types" SET "ksr_key" = 'el', "rule" = 'KSR Part I, Rules 78, 79', "at_once" = 180, "spell_limit" = 240, "surrender_per_year" = 30, "terminal_surrender" = 300 WHERE lower("name") = 'earned leave';--> statement-breakpoint
UPDATE "leave_types" SET "ksr_key" = 'hpl', "rule" = 'KSR Part I, Rules 82, 83' WHERE lower("name") = 'half pay leave';--> statement-breakpoint
UPDATE "leave_types" SET "ksr_key" = 'commuted', "rule" = 'KSR Part I, Rules 84, 74', "spell_limit" = 240 WHERE lower("name") = 'commuted leave';--> statement-breakpoint
UPDATE "leave_types" SET "ksr_key" = 'lnd', "rule" = 'KSR Part I, Rule 85', "medical" = false, "non_medical_at_once" = 90, "non_medical_limit" = 180, "last_resort" = true WHERE lower("name") = 'leave not due';--> statement-breakpoint
UPDATE "leave_types" SET "ksr_key" = 'eol', "rule" = 'KSR Part I, Rule 88' WHERE lower("name") = 'extraordinary leave';--> statement-breakpoint
UPDATE "leave_types" SET "ksr_key" = 'maternity', "rule" = 'KSR Part I, Rule 100', "at_once" = 180 WHERE lower("name") = 'maternity leave';--> statement-breakpoint
UPDATE "leave_types" SET "ksr_key" = 'paternity', "rule" = 'KSR Part I, Rule 102B', "at_once" = 10, "service_limit" = 20 WHERE lower("name") = 'paternity leave';
