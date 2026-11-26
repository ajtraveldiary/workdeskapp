-- Commuted leave may be taken on personal grounds too (user request 2026-11-26): the built-in commuted leave type is
-- no longer "given on a medical certificate", so Mark leave doesn't start ticked or warn without one.
UPDATE "leave_types" SET "medical" = false WHERE "ksr_key" = 'commuted' AND "medical" = true;
