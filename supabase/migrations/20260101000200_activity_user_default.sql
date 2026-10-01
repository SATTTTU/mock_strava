-- Fix: activities.user_id had no default, so a caller had to supply it, and
-- the insert policy (activities_insert_own) requires it to equal auth.uid().
-- The client's insert in src/features/tracking/saveActivity.ts deliberately
-- does not send user_id, so every activity save failed with:
--   new row violates row-level security policy for table "activities"
--
-- Defaulting the column to auth.uid() fixes this at the source. It also removes
-- the client's ability to attribute an activity to someone else: the value is
-- derived from the JWT rather than trusted from the request body.
--
-- No extra CHECK constraint is added on purpose. auth.uid() is only STABLE, so a
-- check constraint calling it is evaluated against the caller's JWT and would
-- break legitimate service-role and migration-time writes. activities_insert_own
-- already enforces the same invariant for user-facing writes, and a default does
-- not weaken it.

alter table public.activities
  alter column user_id set default auth.uid();