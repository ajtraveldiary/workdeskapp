-- Pension tasks (user request 2026-10-08): the "Pension papers" task made 12 months before an employee retires.
ALTER TABLE "employees" ADD COLUMN "pension_task_id" uuid;