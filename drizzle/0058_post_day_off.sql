ALTER TABLE "designations" ADD COLUMN "off_day" text DEFAULT 'sunday' NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "off_day_own" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "gazetted_own" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Keep everyone as now (user's answer 2026-11-10): each post takes the day off most of its employees have (a tie stays
-- Sunday off), and anyone different from their post, or with no post and a weekly off, is kept as an exception.
UPDATE "designations" d SET "off_day" = 'weekly' WHERE (SELECT count(*) FROM "employees" e WHERE e."designation_id" = d."id" AND e."off_day" = 'weekly') > (SELECT count(*) FROM "employees" e WHERE e."designation_id" = d."id" AND e."off_day" = 'sunday');--> statement-breakpoint
UPDATE "employees" e SET "off_day_own" = true WHERE e."off_day" <> coalesce((SELECT d."off_day" FROM "designations" d WHERE d."id" = e."designation_id"), 'sunday');--> statement-breakpoint
-- Gazetted: the post's tick stays as set in Settings › Leave; permanent employees different from it are exceptions.
UPDATE "employees" e SET "gazetted_own" = true WHERE e."permanent" AND e."gazetted" <> coalesce((SELECT d."gazetted" FROM "designations" d WHERE d."id" = e."designation_id"), false);
