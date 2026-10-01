-- M1: extensions, profiles, activities, track_points
-- Strava-like fitness app. Location history lives here, so RLS is mandatory
-- on every table and stats are always recomputed server-side.

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles: 1:1 with auth.users, created by trigger so the client never writes it
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (username ~ '^[a-z0-9_]{3,30}$'),
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar_url text,
  bio text check (char_length(bio) <= 200),
  weight_kg numeric(5, 2) check (weight_kg is null or (weight_kg > 0 and weight_kg <= 300)),
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'Public-facing user profile. Display name and avatar are readable by all authenticated users; weight_kg and bio are private to the owner.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_username text;
begin
  base_username := lower(regexp_replace(
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    '[^a-zA-Z0-9_]', '', 'g'
  ));

  if length(base_username) < 3 then
    base_username := base_username || '_' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;
  base_username := left(base_username, 24);

  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    base_username,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', base_username), 60)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- activities: one row per recorded activity
--
-- Every *_m / *_s / *_mps column is derived data. It is written ONLY by
-- recompute_activity_stats(). A patched client can post whatever values it
-- likes in the insert; the trigger overwrites them before the row is visible.
-- ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  sport_type text not null check (sport_type in ('run', 'ride', 'hike', 'walk')),
  visibility text not null default 'public'
    check (visibility in ('public', 'followers', 'private')),

  started_at timestamptz not null,
  -- client-supplied while recording, replaced by first track point
  ended_at timestamptz,

  distance_m double precision not null default 0,
  moving_time_s double precision not null default 0,
  elapsed_time_s double precision not null default 0,
  elevation_gain_m double precision not null default 0,
  elevation_loss_m double precision not null default 0,
  avg_speed_mps double precision not null default 0,
  max_speed_mps double precision not null default 0,
  point_count integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index activities_user_created_idx on public.activities (user_id, created_at desc);
create index activities_public_feed_idx on public.activities (created_at desc)
  where visibility = 'public';
create index activities_sport_idx on public.activities (sport_type, created_at desc);

-- ---------------------------------------------------------------------------
-- track_points: high volume, so geometry is stored in PostGIS and queried
-- server-side. jsonb-only storage would make segment discovery (M7) impossible
-- without shipping every point to the client.
-- ---------------------------------------------------------------------------
create table public.track_points (
  activity_id uuid not null references public.activities (id) on delete cascade,
  seq integer not null,
  recorded_at timestamptz not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  ele double precision,
  speed_mps double precision,
  accuracy_m double precision,
  geography geography (Point, 4326) not null,
  primary key (activity_id, seq)
);

create index track_points_geography_idx on public.track_points using gist (geography);
create index track_points_activity_time_idx on public.track_points (activity_id, recorded_at);

-- ---------------------------------------------------------------------------
-- stats: server-side recomputation, mirroring src/lib/geo/index.ts
-- ---------------------------------------------------------------------------
create or replace function public.recompute_activity_stats(p_activity_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_first timestamptz;
  v_last timestamptz;
  v_dist double precision;
  v_gain double precision;
  v_loss double precision;
  v_max_speed double precision;
  v_count integer;
  v_moving double precision;
  v_elev_noise double precision := 1.0;
  v_speed_threshold double precision := 0.5;
  v_max_plausible double precision := 12.5;
begin
  select user_id into v_user_id from public.activities where id = p_activity_id;
  if v_user_id is null then
    raise exception 'activity % not found', p_activity_id;
  end if;

  if auth.uid() is not null and auth.uid() <> v_user_id then
    raise exception 'not permitted to recompute stats for activity %', p_activity_id;
  end if;

  -- Window functions cannot appear inside an aggregate, so the lags are
  -- computed once in a CTE and every statistic is derived from it. This
  -- mirrors src/lib/geo/index.ts, including the 1.0 m elevation noise floor and
  -- the 0.5 m/s moving-speed threshold. Speed is also capped: a fix implying
  -- more than 12.5 m/s (45 km/h) is a GPS glitch, not a personal best.
  with lagged as (
    select
      seq,
      recorded_at,
      ele,
      lag(recorded_at) over (order by seq) as prev_t,
      lag(ele)         over (order by seq) as prev_ele,
      lag(geography)    over (order by seq) as prev_geog
    from public.track_points
    where activity_id = p_activity_id
  ),
  d as (
    select
      recorded_at,
      ele,
      prev_ele,
      case
        when prev_t is not null and recorded_at > prev_t
          then st_distance(geography, prev_geog)
      end as seg_m,
      case
        when prev_t is not null and recorded_at > prev_t
          then extract(epoch from (recorded_at - prev_t))
      end as dt
    from lagged
  )
  select
    count(*),
    min(recorded_at),
    max(recorded_at),
    coalesce(sum(seg_m), 0),
    -- elevation gain/loss, ignoring jitter below the noise floor
    coalesce(sum(case
      when prev_ele is not null and ele > prev_ele + v_elev_noise then ele - prev_ele
      else 0 end), 0),
    coalesce(sum(case
      when prev_ele is not null and prev_ele > ele + v_elev_noise then prev_ele - ele
      else 0 end), 0),
    -- max sustained speed, excluding GPS teleport artefacts
    coalesce(max(case
      when dt > 0 and seg_m / dt <= v_max_plausible then seg_m / dt
      else 0 end), 0),
    -- moving time: intervals at or above the moving threshold
    coalesce(sum(case
      when dt > 0 and seg_m / dt >= v_speed_threshold then dt
      else 0 end), 0)
  into v_count, v_first, v_last, v_dist, v_gain, v_loss, v_max_speed, v_moving
  from d;

  update public.activities
  set
    started_at = coalesce(v_first, started_at),
    ended_at = v_last,
    distance_m = v_dist,
    moving_time_s = v_moving,
    elapsed_time_s = coalesce(extract(epoch from (v_last - v_first)), 0),
    elevation_gain_m = v_gain,
    elevation_loss_m = v_loss,
    avg_speed_mps = case
      when v_moving > 0 then v_dist / v_moving else 0 end,
    max_speed_mps = v_max_speed,
    point_count = v_count,
    updated_at = now()
  where id = p_activity_id;
end;
$$;

revoke execute on function public.recompute_activity_stats(uuid) from public;
grant execute on function public.recompute_activity_stats(uuid) to authenticated;

-- Overwrite any client-supplied stats on insert so forged values never persist.
create or replace function public.sanitize_activity_stats()
returns trigger
language plpgsql
as $$
begin
  new.distance_m := 0;
  new.moving_time_s := 0;
  new.elapsed_time_s := 0;
  new.elevation_gain_m := 0;
  new.elevation_loss_m := 0;
  new.avg_speed_mps := 0;
  new.max_speed_mps := 0;
  new.point_count := 0;
  new.ended_at := null;
  return new;
end;
$$;

create trigger activities_sanitize_stats
  before insert on public.activities
  for each row execute function public.sanitize_activity_stats();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger activities_touch_updated_at
  before update on public.activities
  for each row execute function public.touch_updated_at();

-- keep geography in sync with lat/lng
create or replace function public.sync_track_point_geography()
returns trigger language plpgsql as $$
begin
  new.geography := st_setsrid(st_makepoint(new.lng, new.lat), 4326)::geography;
  return new;
end;
$$;

create trigger track_points_sync_geography
  before insert or update of lat, lng on public.track_points
  for each row execute function public.sync_track_point_geography();
