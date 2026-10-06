ALTER TABLE "email_threads" DROP CONSTRAINT IF EXISTS "email_threads_category_id_categories_id_fk";--> statement-breakpoint
ALTER TABLE "reports" DROP CONSTRAINT IF EXISTS "reports_category_id_categories_id_fk";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_category_id_categories_id_fk";--> statement-breakpoint
ALTER TABLE "email_threads" DROP COLUMN "category_id";--> statement-breakpoint
ALTER TABLE "reports" DROP COLUMN "category_id";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "category_id";--> statement-breakpoint
DROP TABLE "categories";
