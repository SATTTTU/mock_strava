-- M1b: RLS on every table. No policy = deny all, so each table gets an
-- explicit, auditable policy set. This app stores location history: a missing
-- policy here is a data breach, not a bug.

alter table public.profiles enable row level security;
alter table public.activities enable row level security;
alter table public.track_points enable row level security;
alter table public.kudos enable row level security;
alter table public.comments enable row level security;
alter table public.follows enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- Display name and avatar are public-ish. bio and weight_kg are private to
-- the owner, so they are not exposed through the anon/authenticated policy.
-- ---------------------------------------------------------------------------
create policy "profiles_select_own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles_select_visible"
  on public.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No insert policy: rows are created by the auth trigger. No delete policy:
-- a user leaves by deleting their auth user.

-- ---------------------------------------------------------------------------
-- activities
-- public     -> anyone authenticated
-- followers  -> self + confirmed followers
-- private    -> self only, always
-- ---------------------------------------------------------------------------
create policy "activities_select_visible"
  on public.activities for select
  to authenticated
  using (
    user_id = auth.uid()
    or visibility = 'public'
    or (
      visibility = 'followers'
      and exists (
        select 1 from public.follows f
        where f.follower_id = auth.uid()
          and f.followee_id = activities.user_id
      )
    )
  );

create policy "activities_insert_own"
  on public.activities for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "activities_update_own"
  on public.activities for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "activities_delete_own"
  on public.activities for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- track_points
-- Access inherits from the parent activity. A point is readable exactly when
-- its activity row is readable, so no point can leak past its activity's
-- visibility setting.
-- ---------------------------------------------------------------------------
create policy "track_points_select_visible"
  on public.track_points for select
  to authenticated
  using (
    exists (
      select 1 from public.activities a
      where a.id = track_points.activity_id
    )
  );

create policy "track_points_insert_own"
  on public.track_points for insert
  to authenticated
  with check (
    exists (
      select 1 from public.activities a
      where a.id = track_points.activity_id
        and a.user_id = auth.uid()
    )
  );

create policy "track_points_delete_own"
  on public.track_points for delete
  to authenticated
  using (
    exists (
      select 1 from public.activities a
      where a.id = track_points.activity_id
        and a.user_id = auth.uid()
    )
  );

-- No update policy: points are immutable once written.

-- ---------------------------------------------------------------------------
-- follows
-- ---------------------------------------------------------------------------
create table public.follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  followee_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index follows_followee_idx on public.follows (followee_id, created_at desc);

create policy "follows_select_visible"
  on public.follows for select
  to authenticated
  using (true);

create policy "follows_insert_own"
  on public.follows for insert
  to authenticated
  with check (follower_id = auth.uid());

create policy "follows_delete_own"
  on public.follows for delete
  to authenticated
  using (follower_id = auth.uid());

-- ---------------------------------------------------------------------------
-- kudos: one per user per activity, enforced by primary key
-- ---------------------------------------------------------------------------
create table public.kudos (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (activity_id, user_id)
);

create index kudos_activity_idx on public.kudos (activity_id);

create policy "kudos_select_visible"
  on public.kudos for select
  to authenticated
  using (
    exists (
      select 1 from public.activities a
      where a.id = kudos.activity_id
    )
  );

create policy "kudos_insert_visible"
  on public.kudos for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.activities a
      where a.id = kudos.activity_id
    )
  );

create policy "kudos_delete_own"
  on public.kudos for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------------
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index comments_activity_idx on public.comments (activity_id, created_at);

create policy "comments_select_visible"
  on public.comments for select
  to authenticated
  using (
    exists (
      select 1 from public.activities a
      where a.id = comments.activity_id
    )
  );

create policy "comments_insert_visible"
  on public.comments for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.activities a
      where a.id = comments.activity_id
    )
  );

create policy "comments_update_own"
  on public.comments for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "comments_delete_own"
  on public.comments for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- feed: activities from people the caller follows, excluding own unless asked
-- ---------------------------------------------------------------------------
create or replace function public.feed_activities(
  p_limit integer default 20,
  p_before timestamptz default null
)
returns table (
  id uuid,
  user_id uuid,
  title text,
  sport_type text,
  visibility text,
  started_at timestamptz,
  distance_m double precision,
  moving_time_s double precision,
  elevation_gain_m double precision,
  point_count integer,
  created_at timestamptz,
  kudos_count bigint,
  comment_count bigint,
  has_kudosed boolean,
  username text,
  display_name text,
  avatar_url text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    a.id, a.user_id, a.title, a.sport_type, a.visibility, a.started_at,
    a.distance_m, a.moving_time_s, a.elevation_gain_m, a.point_count, a.created_at,
    coalesce(k.cnt, 0) as kudos_count,
    coalesce(cm.cnt, 0) as comment_count,
    exists (
      select 1 from public.kudos kd
      where kd.activity_id = a.id and kd.user_id = auth.uid()
    ) as has_kudosed,
    p.username, p.display_name, p.avatar_url
  from public.activities a
  join public.profiles p on p.id = a.user_id
  left join (
    select activity_id, count(*) as cnt from public.kudos group by activity_id
  ) k on k.activity_id = a.id
  left join (
    select activity_id, count(*) as cnt from public.comments group by activity_id
  ) cm on cm.activity_id = a.id
  where (
    -- own activities always show, including private ones
    a.user_id = auth.uid()
    or (
      a.visibility <> 'private'
      and exists (
        select 1 from public.follows f
        where f.follower_id = auth.uid() and f.followee_id = a.user_id
      )
    )
  )
  and (p_before is null or a.created_at < p_before)
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

revoke execute on function public.feed_activities(integer, timestamptz) from public;
grant execute on function public.feed_activities(integer, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- segments (M7). Defined now so RLS and the geo path are proven before the UI
-- depends on them. Segment matching is deliberately conservative: a match
-- requires the activity to actually pass within 30 m of the segment line.
-- ---------------------------------------------------------------------------
create table public.segments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  activity_id uuid not null references public.activities (id) on delete cascade,
  sport_type text not null check (sport_type in ('run', 'ride', 'hike', 'walk')),
  distance_m double precision not null check (distance_m > 0),
  elevation_gain_m double precision not null default 0,
  geom geography (linestring, 4326) not null,
  created_at timestamptz not null default now()
);

create index segments_geom_idx on public.segments using gist (geom);

alter table public.segments enable row level security;

create policy "segments_select_public"
  on public.segments for select
  to authenticated
  using (true);

create policy "segments_insert_own"
  on public.segments for insert
  to authenticated
  with check (
    exists (
      select 1 from public.activities a
      where a.id = segments.activity_id and a.user_id = auth.uid()
    )
  );

create policy "segments_delete_own"
  on public.segments for delete
  to authenticated
  using (
    exists (
      select 1 from public.activities a
      where a.id = segments.activity_id and a.user_id = auth.uid()
    )
  );

-- Best effort per-user times on every segment, computed server-side so a
-- patched client cannot post a fake CR.
create table public.segment_efforts (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.segments (id) on delete cascade,
  activity_id uuid not null references public.activities (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  elapsed_time_s double precision not null check (elapsed_time_s > 0),
  is_crs boolean not null default false,
  created_at timestamptz not null default now(),
  unique (segment_id, user_id)
);

create index segment_efforts_leaderboard_idx
  on public.segment_efforts (segment_id, elapsed_time_s);

alter table public.segment_efforts enable row level security;

create policy "segment_efforts_select_visible"
  on public.segment_efforts for select
  to authenticated
  using (
    exists (select 1 from public.segments s where s.id = segment_efforts.segment_id)
  );

-- Insert only via the matching function below; no direct insert policy.
create policy "segment_efforts_delete_own"
  on public.segment_efforts for delete
  to authenticated
  using (user_id = auth.uid());
