/**
 * Local buffering for in-progress tracks.
 *
 * Points are persisted the moment they arrive rather than held in React state:
 * the OS may kill the app mid-run, and the background task runs in a separate JS
 * context that cannot see component state. Everything here is keyed by
 * activityId so a crash leaves a resumable, uploadable track behind.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GeoPoint } from '../../lib/geo';

export interface PersistedPoint {
  lat: number;
  lng: number;
  ele: number | null;
  t: number;
  speed: number | null;
  acc: number | null;
}

const ACTIVE_KEY = 'tracking:active';
const POINTS_PREFIX = 'tracking:points:';

/** Active recording session, readable from both the UI and the background task. */
export interface ActiveSession {
  activityId: string;
  sportType: string;
  startedAt: number;
  /** False when the user granted foreground-only access; the UI must warn. */
  backgroundAllowed: boolean;
}

export async function setActiveSession(session: ActiveSession): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(session));
}

export async function getActiveSession(): Promise<ActiveSession | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed != null &&
      typeof parsed === 'object' &&
      typeof (parsed as ActiveSession).activityId === 'string' &&
      Number.isFinite((parsed as ActiveSession).startedAt)
    ) {
      return parsed as ActiveSession;
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearActiveSession(): Promise<void> {
  await AsyncStorage.removeItem(ACTIVE_KEY);
}

export async function appendPoints(activityId: string, points: PersistedPoint[]): Promise<void> {
  if (points.length === 0) return;
  const key = POINTS_PREFIX + activityId;

  try {
    const existing = await AsyncStorage.getItem(key);
    const list: PersistedPoint[] = existing ? (JSON.parse(existing) as PersistedPoint[]) : [];
    list.push(...points);
    await AsyncStorage.setItem(key, JSON.stringify(list));
  } catch (error) {
    // Never let a storage failure break recording: the in-memory track the UI
    // holds is still valid, and the user is warned rather than losing the run.
    console.warn('[tracking] appendPoints failed', error);
  }
}

export async function readPoints(activityId: string): Promise<PersistedPoint[]> {
  const raw = await AsyncStorage.getItem(POINTS_PREFIX + activityId);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PersistedPoint[]) : [];
  } catch {
    return [];
  }
}

export async function clearPoints(activityId: string): Promise<void> {
  await AsyncStorage.removeItem(POINTS_PREFIX + activityId);
}

/** Convert buffered points into the app's GeoPoint shape for the geo lib. */
export function toGeoPoints(points: PersistedPoint[]): GeoPoint[] {
  return points.map((p) => ({
    lat: p.lat,
    lng: p.lng,
    ele: p.ele,
    t: p.t,
    speed: p.speed,
    accuracy: p.acc,
  }));
}
