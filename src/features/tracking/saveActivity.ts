/**
 * Persists a finished recording: creates the activity row, uploads track points
 * in batches, then asks Postgres to recompute stats server-side.
 *
 * Local stats are never sent: recompute_activity_stats() overwrites every
 * derived column, so a patched client cannot forge a distance or a time.
 */
import { supabase } from '../../lib/supabase/client';
import { activitySchema, type Activity, type SportType } from '../../lib/validation/schemas';
import type { PersistedPoint } from './localStore';

const BATCH_SIZE = 500;

export interface SaveActivityInput {
  title: string;
  sportType: SportType;
  points: PersistedPoint[];
  visibility?: 'public' | 'followers' | 'private';
}

export async function saveActivity(input: SaveActivityInput): Promise<string> {
  const { title, sportType, points, visibility = 'public' } = input;

  if (points.length < 2) {
    throw new Error('At least two track points are required to save an activity');
  }

  const startedAt = new Date(Math.min(...points.map((p) => p.t))).toISOString();

  const { data: created, error: createError } = await supabase
    .from('activities')
    .insert({
      title,
      sport_type: sportType,
      visibility,
      started_at: startedAt,
    })
    .select('id, user_id, title, sport_type, visibility, started_at, distance_m, moving_time_s, elapsed_time_s, elevation_gain_m, avg_speed_mps, max_speed_mps, point_count, created_at')
    .maybeSingle();

  if (createError) throw new Error(createError.message);

  const activity = activitySchema.parse(created);
  const ordered = [...points].sort((a, b) => a.t - b.t);

  for (let i = 0; i < ordered.length; i += BATCH_SIZE) {
    const batch = ordered.slice(i, i + BATCH_SIZE);
    const rows = batch.map((p, offset) => ({
      activity_id: activity.id,
      seq: i + offset,
      recorded_at: new Date(p.t).toISOString(),
      lat: p.lat,
      lng: p.lng,
      ele: p.ele,
      speed_mps: p.speed,
      accuracy_m: p.acc,
    }));

    const { error } = await supabase.from('track_points').insert(rows);
    if (error) {
      // Roll back so a half-uploaded activity does not linger as a broken row.
      await supabase.from('activities').delete().eq('id', activity.id);
      throw new Error(`Track upload failed: ${error.message}`);
    }
  }

  const { error: statsError } = await supabase.rpc('recompute_activity_stats', {
    p_activity_id: activity.id,
  });
  if (statsError) throw new Error(statsError.message);

  return activity.id;
}

export async function exportGpx(activityId: string, points: PersistedPoint[], title: string, sport: string) {
  const { toGpx } = await import('../../lib/geo/gpx');
  return toGpx(
    points.map((p) => ({ lat: p.lat, lng: p.lng, ele: p.ele, t: p.t, speed: p.speed, accuracy: p.acc })),
    title,
    sport,
  );
}

export type { Activity };
