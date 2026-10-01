import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from './client';
import { useAuth } from './auth';
import {
  activitySchema,
  profileSchema,
  type Activity,
  type ActivityVisibility,
  type SportType,
  type TrackPoint,
} from '../validation/schemas';

export const queryKeys = {
  profile: (id?: string) => ['profile', id ?? 'me'] as const,
  activityList: (userId: string) => ['activities', 'list', userId] as const,
  activityDetail: (id: string) => ['activities', 'detail', id] as const,
  activityStats: () => ['activities', 'stats'] as const,
  feed: () => ['feed'] as const,
  points: (activityId: string) => ['activities', 'points', activityId] as const,
};

const ACTIVITY_COLUMNS =
  'id, user_id, title, sport_type, visibility, started_at, distance_m, moving_time_s, elapsed_time_s, elevation_gain_m, avg_speed_mps, max_speed_mps, point_count, created_at';

function parseRows<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, rows: unknown): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const parsed = schema.safeParse(row);
    return parsed.success && parsed.data != null ? [parsed.data] : [];
  });
}

export function useCurrentUserId(): string | undefined {
  return useAuth().user?.id;
}

export function useProfile() {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: queryKeys.profile(userId),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, bio, weight_kg, created_at')
        .eq('id', userId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const parsed = profileSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
  });
}

export function useUserActivities(userId: string) {
  return useQuery({
    queryKey: queryKeys.activityList(userId),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('activities')
        .select(ACTIVITY_COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return parseRows(activitySchema, data);
    },
  });
}

/** Track points are high volume: fetched only for the detail screen. */
export function useActivityPoints(activityId: string) {
  return useQuery({
    queryKey: queryKeys.points(activityId),
    enabled: !!activityId,
    staleTime: Infinity,
    queryFn: async (): Promise<TrackPoint[]> => {
      const { data, error } = await supabase
        .from('track_points')
        .select('lat, lng, ele, recorded_at, speed_mps, accuracy_m')
        .eq('activity_id', activityId)
        .order('seq', { ascending: true });
      if (error) throw new Error(error.message);

      return (data ?? []).flatMap((row: Record<string, unknown>) => {
        const lat = Number(row.lat);
        const lng = Number(row.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
        return [
          {
            lat,
            lng,
            ele: row.ele == null ? null : Number(row.ele),
            t: row.recorded_at ? new Date(row.recorded_at as string).getTime() : undefined,
            speed: row.speed_mps == null ? null : Number(row.speed_mps),
            acc: row.accuracy_m == null ? null : Number(row.accuracy_m),
          },
        ];
      });
    },
  });
}

export function useUpdateActivity() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      title?: string;
      sport_type?: SportType;
      visibility?: ActivityVisibility;
    }) => {
      const { data, error } = await supabase
        .from('activities')
        .update({
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.sport_type !== undefined ? { sport_type: input.sport_type } : {}),
          ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        })
        .eq('id', input.id)
        .select(ACTIVITY_COLUMNS)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const parsed = activitySchema.safeParse(data);
      if (!parsed.success) throw new Error('Activity update returned an unexpected shape');
      return parsed.data;
    },
    onSuccess: (activity) => {
      void qc.invalidateQueries({ queryKey: queryKeys.activityDetail(activity.id) });
      void qc.invalidateQueries({ queryKey: queryKeys.activityList(activity.user_id) });
      void qc.invalidateQueries({ queryKey: queryKeys.activityStats() });
      void qc.invalidateQueries({ queryKey: queryKeys.feed() });
    },
  });
}

export function useDeleteActivity() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (activityId: string) => {
      const { error } = await supabase.from('activities').delete().eq('id', activityId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['activities'] });
      void qc.invalidateQueries({ queryKey: queryKeys.feed() });
    },
  });
}

export interface ActivityTotals {
  count: number;
  totalDistance: number;
  totalMovingTime: number;
  totalElevation: number;
  bySport: Record<string, { count: number; distance: number }>;
}

export function useActivityStats(userId: string) {
  return useQuery({
    queryKey: queryKeys.activityStats(),
    enabled: !!userId,
    queryFn: async (): Promise<ActivityTotals> => {
      const { data, error } = await supabase
        .from('activities')
        .select('sport_type, distance_m, moving_time_s, elevation_gain_m')
        .eq('user_id', userId)
        .limit(5000);
      if (error) throw new Error(error.message);

      const bySport: ActivityTotals['bySport'] = {};
      let totalDistance = 0;
      let totalMovingTime = 0;
      let totalElevation = 0;

      for (const row of data ?? []) {
        const sport = String(row.sport_type);
        const distance = Number(row.distance_m) || 0;
        bySport[sport] = bySport[sport] ?? { count: 0, distance: 0 };
        bySport[sport].count += 1;
        bySport[sport].distance += distance;
        totalDistance += distance;
        totalMovingTime += Number(row.moving_time_s) || 0;
        totalElevation += Number(row.elevation_gain_m) || 0;
      }

      return {
        count: (data ?? []).length,
        totalDistance,
        totalMovingTime,
        totalElevation,
        bySport,
      };
    },
  });
}

export interface FeedItem extends Activity {
  username: string;
  display_name: string;
  avatar_url: string | null;
  kudos_count: number;
  comment_count: number;
  has_kudosed: boolean;
}

/** Cursor pagination on created_at — offset pagination skips rows as data lands. */
export function useFeed() {
  return useInfiniteQuery({
    queryKey: queryKeys.feed(),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.rpc('feed_activities', {
        p_limit: 20,
        p_before: pageParam,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as FeedItem[];
    },
    getNextPageParam: (last) => (last.length < 20 ? undefined : last[last.length - 1]?.created_at ?? undefined),
  });
}

export function useToggleKudos() {
  const qc = useQueryClient();
  const userId = useCurrentUserId();

  return useMutation({
    mutationFn: async ({ activityId, hasKudosed }: { activityId: string; hasKudosed: boolean }) => {
      if (!userId) throw new Error('Not signed in');
      if (hasKudosed) {
        const { error } = await supabase
          .from('kudos')
          .delete()
          .eq('activity_id', activityId)
          .eq('user_id', userId);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from('kudos')
          .insert({ activity_id: activityId, user_id: userId });
        if (error) throw new Error(error.message);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.feed() });
    },
  });
}
