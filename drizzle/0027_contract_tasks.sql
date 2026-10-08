ALTER TABLE "employees" ADD COLUMN "contract_task_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "contract_task_for" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "system_kind" text;--> statement-breakpoint
-- Pension papers tasks already made are system tasks of that kind.
UPDATE "tasks" SET "system_kind" = 'pension' WHERE "id" IN (SELECT "pension_task_id" FROM "employees" WHERE "pension_task_id" IS NOT NULL);
