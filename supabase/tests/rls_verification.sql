-- Verifies the privacy properties the schema claims. Each case asserts a
-- property, not just that a query returns rows, because a silently permissive
-- policy looks exactly like a correct one from the app.
--
-- Portable on purpose: no psql meta-commands, so this runs both locally
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_verification.sql
-- and against the hosted project via scripts/apply-migration.ps1.
--
-- The whole thing is wrapped in a transaction that is rolled back, so running
-- it cannot leave test rows in the real database.

begin;

-- Minimal assertion helpers. pgTAP is not installed on a bare Supabase
-- instance, and these tests need no test-runner integration: an assertion
-- raises, so the script aborts on the first failure.
create schema if not exists assert;

create or replace function assert.ok(condition boolean, msg text)
returns void language plpgsql as $body$
begin
  if condition is not true then
    raise exception 'FAIL: %', msg;
  end if;
  raise notice 'PASS: %', msg;
end $body$;

-- Overloaded rather than anyelement: comparing a bigint count against an
-- integer literal is legal SQL but no single anyelement signature accepts it.
create or replace function assert.eq(actual numeric, expected numeric, msg text)
returns void language plpgsql as $body$
begin
  if actual is distinct from expected then
    raise exception 'FAIL: % (expected %, got %)', msg, expected, actual;
  end if;
  raise notice 'PASS: %', msg;
end $body$;

create or replace function assert.eq(actual double precision, expected double precision, msg text)
returns void language plpgsql as $body$
declare
  v_ok boolean;
begin
  -- Stats columns are double precision, so an integer literal would not match a
  -- numeric signature. Compare with a tolerance rather than exactly: these are
  -- geodesic distances and floats are not decimal.
  if actual is null or expected is null then
    v_ok := (actual is not distinct from expected);
  else
    v_ok := abs(actual - expected) <= greatest(abs(expected) * 0.0001, 1e-9);
  end if;

  if not v_ok then
    raise exception 'FAIL: % (expected ~%, got %)', msg, expected, actual;
  end if;
  raise notice 'PASS: %', msg;
end $body$;

create or replace function assert.eq(actual text, expected text, msg text)
returns void language plpgsql as $body$
begin
  if actual is distinct from expected then
    raise exception 'FAIL: % (expected %, got %)', msg, expected, actual;
  end if;
  raise notice 'PASS: %', msg;
end $body$;

create or replace function assert.between(actual double precision, lo double precision, hi double precision, msg text)
returns void language plpgsql as $body$
begin
  if actual is null or actual < lo or actual > hi then
    raise exception 'FAIL: % (expected %..%, got %)', msg, lo, hi, actual;
  end if;
  raise notice 'PASS: %', msg;
end $body$;

create or replace function assert.lt(actual double precision, bound double precision, msg text)
returns void language plpgsql as $body$
begin
  if actual is null or actual >= bound then
    raise exception 'FAIL: % (expected < %, got %)', msg, bound, actual;
  end if;
  raise notice 'PASS: %', msg;
end $body$;

create or replace function assert.ge(actual double precision, bound double precision, msg text)
returns void language plpgsql as $body$
begin
  if actual is null or actual < bound then
    raise exception 'FAIL: % (expected >= %, got %)', msg, bound, actual;
  end if;
  raise notice 'PASS: %', msg;
end $body$;

-- The rest of the script runs as `authenticated` to exercise RLS, so the
-- helpers have to be callable by that role. `authenticated` is created by
-- Supabase's bootstrap, not by these migrations.
grant usage on schema assert to authenticated;
grant execute on all functions in schema assert to authenticated;

-- Each assertion raises its own NOTICE, so a passing run prints a readable
-- transcript instead of a bare zero exit code.

-- Two users: alice and bob.
create extension if not exists pgcrypto;

insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'alice@example.com', '{"username":"alice"}'),
  ('22222222-2222-2222-2222-222222222222', 'bob@example.com',   '{"username":"bob"}');

-- The auth trigger should have made a profile for each, derived from the
-- username metadata rather than written by the client.
-- Scoped to the two test users rather than counting the whole table, so this
-- also passes against a database that has real signups in it.
select assert.eq(
  (select count(*) from public.profiles
    where id in ('11111111-1111-1111-1111-111111111111',
                 '22222222-2222-2222-2222-222222222222')), 2,
  'auth trigger created exactly one profile per user'
);

-- ---------------------------------------------------------------------------
-- Case 1: forged stats must not survive the insert
-- ---------------------------------------------------------------------------
insert into public.activities (
  id, user_id, title, sport_type, visibility, started_at,
  distance_m, moving_time_s, avg_speed_mps, point_count, ended_at
) values (
  'aaaaaaaa-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'forged', 'run', 'public', now(),
  999999, 1, 999999, 9999, now()
);

select assert.eq(
  (select distance_m from public.activities where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0, 'sanitize trigger zeroed a client-supplied distance_m'
);

-- A private activity for bob, invisible to alice.
insert into public.activities (id, user_id, title, sport_type, visibility, started_at)
values (
  'aaaaaaaa-0000-0000-0000-000000000002',
  '22222222-2222-2222-2222-222222222222',
  'bob private', 'ride', 'private', now()
);

insert into public.activities (id, user_id, title, sport_type, visibility, started_at)
values (
  'aaaaaaaa-0000-0000-0000-000000000003',
  '22222222-2222-2222-2222-222222222222',
  'bob followers', 'ride', 'followers', now()
);

-- A track point on bob's private activity: the sharpest leak to check.
insert into public.track_points (activity_id, seq, recorded_at, lat, lng)
values ('aaaaaaaa-0000-0000-0000-000000000002', 0, now(), 51.5, -0.12);

-- ---------------------------------------------------------------------------
-- Case 2: cross-user visibility, as alice
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select assert.eq(
  (select count(*) from public.activities), 1,
  'alice sees her own public activity and none of bob private-or-followers'
);

select assert.eq(
  (select count(*) from public.activities where visibility = 'private'), 0,
  'alice cannot see any private activity'
);

select assert.eq(
  (select count(*) from public.track_points), 0,
  'track_points inherits activity visibility: no point leaks from a private run'
);

-- Case: without the exists() on the parent activity this would be 1.
select assert.eq(
  (select count(*) from public.activities where id = 'aaaaaaaa-0000-0000-0000-000000000003'), 0,
  'alice does not see bob followers-only activity without a follow'
);

-- ---------------------------------------------------------------------------
-- Case 3: following grants followers visibility
-- ---------------------------------------------------------------------------
insert into public.follows (follower_id, followee_id)
values ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

select assert.eq(
  (select count(*) from public.activities where id = 'aaaaaaaa-0000-0000-0000-000000000003'), 1,
  'after following, alice sees bob followers-only activity'
);

select assert.eq(
  (select count(*) from public.activities where id = 'aaaaaaaa-0000-0000-0000-000000000002'), 0,
  'following still does not reveal a private activity'
);

-- ---------------------------------------------------------------------------
-- Case 4: private columns stay private. RLS cannot do this on its own, so the
-- column grant in the migration is what enforces it.
-- ---------------------------------------------------------------------------
-- Owners can read and write their own private columns.
update public.profiles
   set bio = 'alice private note', weight_kg = 68.5
 where id = '11111111-1111-1111-1111-111111111111';

select assert.eq(
  (select bio from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'alice private note', 'alice can read her own bio'
);

-- The property that actually matters: no other user's private columns are
-- reachable. A permissive row policy here would be a data breach.
select assert.eq(
  (select count(*) from public.profiles
    where id = '22222222-2222-2222-2222-222222222222'),
  0, 'alice cannot read any column of bob profiles row'
);

-- And she cannot write to it either.
do $body$
declare
  v_rows integer;
begin
  -- RLS makes the row invisible, so this silently affects zero rows rather than
  -- erroring. Only the row count reveals the refusal, which is why it is
  -- asserted explicitly instead of relying on an exception.
  update public.profiles set bio = 'defaced'
   where id = '22222222-2222-2222-2222-222222222222';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: alice updated bob profile (% rows affected)', v_rows;
  end if;
  raise notice 'PASS: %', 'alice cannot write to bob profile';
end $body$;

-- The public view is how bob's name reaches alice's feed.
select assert.eq(
  (select display_name from public.profiles_public
    where id = '22222222-2222-2222-2222-222222222222'),
  'bob', 'profiles_public exposes another user display name'
);

-- And the view must not carry the private columns.
select assert.eq(
  (select count(*) from information_schema.columns
    where table_name = 'profiles_public' and column_name in ('bio', 'weight_kg')),
  0, 'profiles_public does not expose bio or weight_kg'
);

-- ---------------------------------------------------------------------------
-- Case 5: the client's own insert shape. saveActivity.ts sends no user_id and
-- relies on the column default. Before migration 20260101000200 this failed the
-- activities_insert_own policy, so no activity could ever be saved.
-- ---------------------------------------------------------------------------
do $body$
declare
  v_id uuid;
begin
  insert into public.activities (title, sport_type, visibility, started_at)
  values ('client shape', 'run', 'public', now())
  returning id into v_id;

  if v_id is null then
    raise exception 'FAIL: client-shaped insert returned no id';
  end if;

  -- The default must be the caller, not null and not anyone else.
  perform 1 from public.activities a
   where a.id = v_id and a.user_id = auth.uid();
  if not found then
    raise exception 'FAIL: user_id default is not auth.uid()';
  end if;

  -- And a caller-supplied foreign user_id must still be refused, so the
  -- default is not merely a hole an attacker can opt out of.
  begin
    insert into public.activities (user_id, title, sport_type, visibility, started_at)
    values ('22222222-2222-2222-2222-222222222222', 'impersonation', 'run', 'public', now());
    raise exception 'FAIL: alice created an activity owned by bob';
  exception when insufficient_privilege then
    raise notice 'PASS: %', 'insert naming another user_id is refused';
  end;
end $body$;

-- ---------------------------------------------------------------------------
-- Case 6: recompute derives stats from points, ignoring what the client said
-- ---------------------------------------------------------------------------
reset role;

-- ~111 m per step near the equator, 10 s apart: ~11.1 m/s, under the 12.5 cap.
insert into public.activities (id, user_id, title, sport_type, visibility, started_at)
values (
  'aaaaaaaa-0000-0000-0000-000000000004',
  '11111111-1111-1111-1111-111111111111',
  'real', 'run', 'public', now()
);

-- 2.5 m per step: deliberately above the 1.0 m noise floor, because the floor
-- is applied per step. A 0.5 m ramp is indistinguishable from barometric
-- jitter and is correctly reported as flat -- see the next case.
insert into public.track_points (activity_id, seq, recorded_at, lat, lng, ele)
select
  'aaaaaaaa-0000-0000-0000-000000000004',
  g,
  '2026-01-01 10:00:00+00'::timestamptz + (g * 10) * interval '1 second',
  51.5 + (g * 0.001),
  -0.12,
  10 + g * 2.5
from generate_series(0, 10) g;

select public.recompute_activity_stats('aaaaaaaa-0000-0000-0000-000000000004');

select assert.eq(
  (select point_count from public.activities where id = 'aaaaaaaa-0000-0000-0000-000000000004'),
  11, 'recompute counted every point'
);

select assert.eq(
  (select moving_time_s from public.activities where id = 'aaaaaaaa-0000-0000-0000-000000000004'),
  100, 'recompute measured 10 intervals of 10 s as moving time'
);

-- 10 steps * 0.001 deg latitude at ~111.2 km/deg = ~1112 m. Allow 2% for the
-- haversine/geodesic difference between PostGIS and the app's implementation.
select assert.between(
  (select distance_m from public.activities where id = 'aaaaaaaa-0000-0000-0000-000000000004'),
  1090, 1135,
  'recomputed distance is plausible for 10 * 0.001 deg of latitude'
);

select assert.eq(
  (select elevation_gain_m from public.activities where id = 'aaaaaaaa-0000-0000-0000-000000000004'),
  25, 'elevation gain sums steps above the 1 m noise floor: 10 steps x 2.5 m'
);

-- A run on a flat road, where the altimeter oscillates +/- 0.4 m. Without the
-- noise floor this reports hundreds of metres of "climbing" on a treadmill.
insert into public.activities (id, user_id, title, sport_type, visibility, started_at)
values (
  'aaaaaaaa-0000-0000-0000-000000000006',
  '11111111-1111-1111-1111-111111111111',
  'flat with jitter', 'run', 'public', now()
);

insert into public.track_points (activity_id, seq, recorded_at, lat, lng, ele)
select
  'aaaaaaaa-0000-0000-0000-000000000006',
  g,
  '2026-01-01 12:00:00+00'::timestamptz + (g * 10) * interval '1 second',
  52.0 + (g * 0.001),
  0.5,
  10 + (case when g % 2 = 0 then 0.4 else -0.4 end)
from generate_series(0, 20) g;

select public.recompute_activity_stats('aaaaaaaa-0000-0000-0000-000000000006');

select assert.eq(
  (select elevation_gain_m from public.activities where id = 'aaaaaaaa-0000-0000-0000-000000000006'),
  0, 'sub-noise-floor altimeter jitter reports zero gain on a flat run'
);

-- 1112 m over 100 s. Asserted as a range because the exact geodesic distance
-- depends on PostGIS's earth model, not on our arithmetic.
select assert.between(
  (select avg_speed_mps from public.activities where id = 'aaaaaaaa-0000-0000-0000-000000000004'),
  11.0, 11.3,
  'avg speed is distance over moving time'
);

-- A GPS teleport must be rejected rather than recorded as a 3000 km/h run.
insert into public.track_points (activity_id, seq, recorded_at, lat, lng, ele)
values ('aaaaaaaa-0000-0000-0000-000000000004', 99,
        '2026-01-01 11:00:00+00', 40.0, -74.0, 10);

select public.recompute_activity_stats('aaaaaaaa-0000-0000-0000-000000000004');

select assert.lt(
  (select max_speed_mps from public.activities where id = 'aaaaaaaa-0000-0000-0000-000000000004'),
  12.5,
  'implausible GPS speed is capped, not recorded'
);

-- ---------------------------------------------------------------------------
-- Case 7: a user cannot recompute someone else's activity
-- ---------------------------------------------------------------------------
-- Bob's activities must be created as the owner, not as alice. Alice's insert
-- would fail activities_insert_own, which is the point of that policy but not
-- what this case is testing.
reset role;

insert into public.activities (id, user_id, title, sport_type, visibility, started_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222',
   'bob private run', 'run', 'private', now()),
  ('aaaaaaaa-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222',
   'bob public run', 'run', 'public', now());

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- Sanity: the owner CAN recompute her own. Without this, a bug that refused
-- everyone would pass the cross-user cases below.
select public.recompute_activity_stats('aaaaaaaa-0000-0000-0000-000000000004');

-- Both blocks below assert the same way: the call must fail, and it must fail
-- for the ownership reason rather than incidentally. If the function raised
-- nothing, the explicit FAIL exception fires and is re-raised because its
-- message does not match '%not permitted%'.
do $body$
begin
  perform public.recompute_activity_stats('aaaaaaaa-0000-0000-0000-000000000005');
  raise exception 'FAIL: alice recomputed bob private activity';
exception
  when insufficient_privilege then
    raise notice 'PASS: %',
      'recompute of another user private activity is refused (row hidden by RLS)';
  when others then
    if sqlerrm not like '%not permitted%' then raise; end if;
    raise notice 'PASS: %',
      'recompute of another user private activity is refused (ownership check)';
end $body$;

-- Also refuse a public activity bob owns, so the guard is not merely an
-- artifact of private rows being invisible. This one is the stronger check:
-- RLS lets alice read the row, so only the explicit ownership test can stop it.
do $body$
begin
  perform public.recompute_activity_stats('aaaaaaaa-0000-0000-0000-000000000007');
  raise exception 'FAIL: alice recomputed bob PUBLIC activity';
exception when others then
  if sqlerrm not like '%not permitted%' then raise; end if;
  raise notice 'PASS: %',
    'recompute of another user PUBLIC activity is refused by the ownership check';
end $body$;

-- ---------------------------------------------------------------------------
-- Case 8: feed pagination and own-activity inclusion
-- ---------------------------------------------------------------------------
select assert.ge(
  (select count(*) from public.feed_activities(20, null)), 3,
  'feed includes own activities plus followed users'
);

-- p_before must exclude the boundary row rather than duplicating it.
select assert.eq(
  (select count(*) from public.feed_activities(
     20, (select created_at from public.activities
           where id = 'aaaaaaaa-0000-0000-0000-000000000001'))),
  0, 'p_before excludes the boundary row, so pages do not overlap'
);

rollback;