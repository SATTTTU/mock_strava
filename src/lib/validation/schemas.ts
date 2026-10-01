import { z } from 'zod';

export const sportTypeSchema = z.enum(['run', 'ride', 'hike', 'walk']);
export type SportType = z.infer<typeof sportTypeSchema>;

export const activityVisibilitySchema = z.enum(['public', 'followers', 'private']);
export type ActivityVisibility = z.infer<typeof activityVisibilitySchema>;

export const profileSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(3).max(30),
  display_name: z.string().min(1).max(60),
  avatar_url: z.string().nullable(),
  bio: z.string().max(200).nullable(),
  weight_kg: z.number().positive().max(300).nullable(),
  created_at: z.string(),
});
export type Profile = z.infer<typeof profileSchema>;

/**
 * A point as used by the geo layer. `t` is optional because some GPX exports
 * omit timestamps; callers substitute a synthetic cadence before computing
 * time-based stats.
 */
export const trackPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  ele: z.number().nullable().optional(),
  t: z.number().int().positive().optional(),
  acc: z.number().nonnegative().nullable().optional(),
  speed: z.number().nonnegative().nullable().optional(),
});
export type TrackPoint = z.infer<typeof trackPointSchema>;

export const activitySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  sport_type: sportTypeSchema,
  visibility: activityVisibilitySchema,
  started_at: z.string(),
  distance_m: z.number().nonnegative(),
  moving_time_s: z.number().nonnegative(),
  elapsed_time_s: z.number().nonnegative(),
  elevation_gain_m: z.number(),
  avg_speed_mps: z.number().nonnegative(),
  max_speed_mps: z.number().nonnegative(),
  point_count: z.number().int().nonnegative(),
  created_at: z.string(),
});
export type Activity = z.infer<typeof activitySchema>;

export const activityDetailSchema = activitySchema.extend({
  profile: profileSchema.nullable(),
  points: z.array(trackPointSchema),
  kudos_count: z.number().int().nonnegative(),
  comment_count: z.number().int().nonnegative(),
  has_kudosed: z.boolean(),
});
export type ActivityDetail = z.infer<typeof activityDetailSchema>;

export const activityInsertSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  sport_type: sportTypeSchema,
  visibility: activityVisibilitySchema.default('public'),
  started_at: z.string().datetime(),
});
export type ActivityInsert = z.infer<typeof activityInsertSchema>;

export const kudosSchema = z.object({
  id: z.string().uuid(),
  activity_id: z.string().uuid(),
  user_id: z.string().uuid(),
  created_at: z.string(),
});
export type Kudos = z.infer<typeof kudosSchema>;

export const commentSchema = z.object({
  id: z.string().uuid(),
  activity_id: z.string().uuid(),
  user_id: z.string().uuid(),
  body: z.string().min(1).max(500),
  created_at: z.string(),
  profile: profileSchema.nullable(),
});
export type Comment = z.infer<typeof commentSchema>;

export const followSchema = z.object({
  follower_id: z.string().uuid(),
  followee_id: z.string().uuid(),
  created_at: z.string(),
});
export type Follow = z.infer<typeof followSchema>;
