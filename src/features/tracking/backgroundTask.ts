/**
 * Module-scope background location task.
 *
 * TaskManager.defineTask must run in the top-level scope of the JS bundle. When
 * the app is relaunched in the background no component is mounted, so anything
 * registered inside a component would never run. This module is imported once
 * from TrackingContext, before startLocationUpdatesAsync is called.
 *
 * The task callback runs in its own JS context: it receives no closure state.
 * Everything it needs comes from the task payload and from AsyncStorage.
 */
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import type { LocationObject } from 'expo-location';

import { appendPoints, getActiveSession, type PersistedPoint } from './localStore';

export const LOCATION_TASK_NAME = 'mock-strava-background-location';

let buffer: PersistedPoint[] = [];

function toPersisted(location: LocationObject): PersistedPoint | null {
  const { latitude, longitude, altitude, speed, accuracy } = location.coords;
  // timestamp lives on LocationObject, not on coords.
  const timestamp = location.timestamp;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  return {
    lat: latitude,
    lng: longitude,
    ele: altitude != null && Number.isFinite(altitude) ? altitude : null,
    t: Number.isFinite(timestamp) ? timestamp : Date.now(),
    speed: speed != null && Number.isFinite(speed) ? speed : null,
    acc: accuracy != null && Number.isFinite(accuracy) ? accuracy : null,
  };
}

async function flush(sessionId?: string): Promise<void> {
  if (buffer.length === 0) return;
  const id = sessionId ?? (await getActiveSession())?.activityId;
  if (!id) return;

  const batch = buffer;
  buffer = [];
  await appendPoints(id, batch);
}

TaskManager.defineTask<{ locations?: LocationObject[] }>(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    // The OS reports task errors (e.g. permission revoked mid-run). Stop
    // tracking rather than looping: a stuck task drains the battery forever.
    console.warn('[tracking] background task error:', error.message);
    await stopQuietly();
    return;
  }

  // startLocationUpdatesAsync in SDK 57 takes no data payload, and `data` is
  // null on some OS-initiated restarts. The session id is recovered from
  // AsyncStorage, which is the only durable source available here.
  const activityId = (await getActiveSession())?.activityId;
  if (!activityId) {
    console.warn('[tracking] no active session; stopping background tracking');
    await stopQuietly();
    return;
  }

  for (const location of data?.locations ?? []) {
    const point = toPersisted(location);
    if (point) buffer.push(point);
  }

  // Always flush, not only at the threshold: the process can be killed before
  // the batch fills, and a short run must not be lost.
  await flush(activityId);
});

async function stopQuietly(): Promise<void> {
  try {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  } catch {
    // already stopped
  }
}

export { flush as flushBackgroundBuffer };
