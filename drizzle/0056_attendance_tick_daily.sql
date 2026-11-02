-- The register keeper ticks everyone every day (user's answer 2026-11-02, docs/ATTENDANCE_ASSIST_PLAN.md): days not
-- marked no longer count as duty, also where the settings were already saved with it on.
UPDATE "attendance_settings" SET "data" = "data" || '{"assumeDuty": false}'::jsonb;
