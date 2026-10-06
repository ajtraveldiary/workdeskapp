ALTER TABLE "reports" ALTER COLUMN "frequency" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "due_month_offset" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "due_month_offset" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "year_start_month" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "year_start_month" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "lead_days" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "priority" SET DEFAULT 'normal';--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "first_period_start" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "repeat" text DEFAULT 'never' NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "start_date" date;--> statement-breakpoint
-- Reports become reminders (2026-10-06): the same frequency as a repeat, starting on the first period's due date
-- (period start + its length - 1 + the due month offset, on the due day clamped to that month's length).
UPDATE "reports" SET "repeat" = CASE "frequency" WHEN 'monthly' THEN 'monthly' WHEN 'quarterly' THEN 'quarterly' WHEN 'half_yearly' THEN 'half_yearly' ELSE 'yearly' END;--> statement-breakpoint
WITH m AS (
  SELECT "id", (date_trunc('month', "first_period_start") + make_interval(months => (CASE "frequency" WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 WHEN 'half_yearly' THEN 6 ELSE 12 END) - 1 + "due_month_offset"))::date AS due_month
  FROM "reports"
)
UPDATE "reports" r SET "start_date" = m.due_month + (least(r."due_day", extract(day from (m.due_month + interval '1 month' - interval '1 day'))::int) - 1)
FROM m WHERE m."id" = r."id";--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "start_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "due_time" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "end_date" date;