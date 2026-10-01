# Mock Strava — Architecture

## Stack

Expo SDK 57 (React Native 0.86) · Expo Router · TypeScript · Supabase (auth, Postgres, PostGIS) · TanStack Query · Zod · Jest

## Directory ownership

Each directory is owned by exactly one agent (see `.opencode/agent/`). That is
what lets `db`, `geo`, `ui`, and `recorder` work in parallel without merge
conflicts.

| Path | Owner | Contains |
|---|---|---|
| `app/` | `ui` | Routes only. Every file is a screen; `_layout.tsx` defines navigators. |
| `src/components/` | `ui` | Shared presentational components. |
| `src/theme/` | `ui` | Design tokens. No hardcoded colours outside this file. |
| `src/lib/geo/` | `geo` | Pure GPS math, GPX parsing. No React, no Expo imports. |
| `src/lib/format.ts` | `geo` | Unit formatting. |
| `src/lib/validation/` | `geo` | Zod schemas — the app's trust boundary. |
| `src/lib/supabase/` | `dataclient` | Client, auth, queries, query keys. |
| `src/features/tracking/` | `recorder` | Recording lifecycle, background task, local buffer, upload. |
| `supabase/migrations/` | `db` | Schema, RLS, server-side stats functions. |
| `__tests__/` | `qa` | Tests. |
| `eas.json`, `app.json`, CI | `release` | Build and distribution. |

## Data flow

```
GPS fix
  → expo-location watcher (foreground, fast)
  → localStore.appendPoints      ← persisted immediately, survives process death
  → state (live map, live stats)
  → [Finish] → saveActivity
      → insert activities row    ← stats columns zeroed by trigger
      → insert track_points      ← 500-row batches
      → recompute_activity_stats ← server recomputes, client values ignored
```

## Security model

The anon key ships in the client by design; RLS is the enforcement layer, not
key secrecy. Two properties are load-bearing:

1. **Stats are always recomputed server-side.** `sanitize_activity_stats` zeroes
   every derived column on insert, and `recompute_activity_stats` fills them from
   the raw points. A patched client cannot post a fake distance, so M7
   leaderboards cannot be forged.
2. **Track points inherit activity visibility.** The `track_points` select policy
   checks that the parent activity is visible, so no point can leak past its
   activity's privacy setting.

Run `@review` before every milestone gate. A missing RLS policy here is a data
breach, not a bug.

## Accuracy decisions

These thresholds are deliberate. Changing one changes what users see.

| Constant | Value | Why |
|---|---|---|
| Elevation noise floor | 1.0 m | GPS altitude oscillates; without this, a flat run reports absurd gain. |
| Moving-speed threshold | 0.5 m/s | Below this a user is stopped. Excluding it from moving time is what users mean by "moving time". |
| Max plausible speed | 12.5 m/s (45 km/h) | Anything faster is a GPS glitch, not a personal best. Applied in both TS and SQL. |
| Max fix accuracy | 50 m | Rejects fixes too vague to place on a route. |

`filterTrack` deliberately **keeps** stationary points. They add no distance but
carry the timestamps that record a stop. Sample-rate reduction belongs to the
OS-level `distanceInterval`, not to the filter.

## Milestone gates

No milestone starts until the previous one is met.

| # | Scope | Gate |
|---|---|---|
| M0 | Foundation | App boots, Supabase linked, dev build runs on a device, typecheck clean |
| M1 | Schema + auth | Signup/login works, profile auto-created, RLS blocks cross-user reads |
| M2 | Recorder | Records a run, survives backgrounding, points persisted |
| M3 | Activity CRUD | List, detail with polyline, edit, delete |
| M4 | Stats | Distance/pace/elevation correct against fixtures |
| M5 | Public beta | Signed APK, 5–10 testers onboarded |
| M6 | Social | Follow, feed, kudos, comments |
| M7 | Segments | PostGIS matching, server-side leaderboard |

## Environment

Copy `.env.example` to `.env` and fill in the Supabase project URL and anon key.
The service-role key must never be added to `.env` or any file that reaches the
bundle.
