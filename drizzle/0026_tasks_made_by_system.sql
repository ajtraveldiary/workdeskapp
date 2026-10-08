ALTER TABLE "tasks" ADD COLUMN "made_by_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Pension papers tasks made before this column existed are made by the system too.
UPDATE "tasks" SET "made_by_system" = true WHERE "id" IN (SELECT "pension_task_id" FROM "employees" WHERE "pension_task_id" IS NOT NULL);
