import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Haptics from 'expo-haptics';

import './backgroundTask';
import { LOCATION_TASK_NAME, flushBackgroundBuffer } from './backgroundTask';
import {
  appendPoints,
  clearActiveSession,
  clearPoints,
  getActiveSession,
  readPoints,
  setActiveSession,
  toGeoPoints,
  type ActiveSession,
  type PersistedPoint,
} from './localStore';
import { computeStats, filterTrack, ACCURACY_TO_DISPLACEMENT_M, type GeoPoint } from '../../lib/geo';

export type TrackingStatus =
  | 'idle'
  | 'acquiring'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'error';

export interface TrackingWarning {
  kind: 'no-background' | 'weak-signal' | 'services-off' | 'error';
  message: string;
}

export interface TrackingState {
  status: TrackingStatus;
  session: ActiveSession | null;
  points: PersistedPoint[];
  stats: ReturnType<typeof computeStats> | null;
  /** Wall-clock ms at which the current run started; drives the timer. */
  elapsedMs: number;
  warning: TrackingWarning | null;
  rejectedPoints: number;
}

interface TrackingActions {
  start: (sportType: string) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  discard: () => Promise<void>;
  /** Ask for "Always" location access so tracking survives app switching. */
  requestBackground: () => Promise<boolean>;
  /** Points buffered locally, ready to upload. */
  takeBufferedPoints: () => Promise<PersistedPoint[]>;
}

const initialState: TrackingState = {
  status: 'idle',
  session: null,
  points: [],
  stats: null,
  elapsedMs: 0,
  warning: null,
  rejectedPoints: 0,
};

const TrackingContext = createContext<(TrackingState & TrackingActions) | null>(null);

function derive(points: PersistedPoint[], rejected: number) {
  const filtered = filterTrack(toGeoPoints(points));
  return { stats: computeStats(filtered.points), rejected: rejected + filtered.rejected };
}

export function TrackingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<TrackingState>(initialState);
  const pointsRef = useRef<PersistedPoint[]>([]);
  const rejectedRef = useRef(0);
  const startedAtRef = useRef<number>(0);
  const foregroundSubscription = useRef<Location.LocationSubscription | null>(null);
  const pausedAtRef = useRef<number | null>(null);
  const pausedTotalRef = useRef(0);

  /**
   * Points are written to storage as they arrive, so there is normally nothing
   * left to flush here. The background buffer is still flushed because it is a
   * separate JS context with its own copy of the queue.
   */
  const persist = useCallback(async () => {
    pointsRef.current = [];
    await flushBackgroundBuffer();
  }, []);

  // Recover an in-progress run after a cold start or process death.
  useEffect(() => {
    let active = true;

    void (async () => {
      const session = await getActiveSession();
      if (!active || !session) return;

      const restored = await readPoints(session.activityId);
      const taskStillRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);

      if (!active) return;

      pointsRef.current = [];
      startedAtRef.current = session.startedAt;
      const { stats, rejected } = derive(restored, 0);
      rejectedRef.current = rejected;

      setState((prev) => ({
        ...prev,
        status: taskStillRunning ? 'recording' : 'paused',
        session,
        points: restored,
        stats,
        warning: session.backgroundAllowed
          ? null
          : {
              kind: 'no-background',
              message: 'Background access was not granted, so tracking stops when you switch apps.',
            },
      }));
    })();

    return () => {
      active = false;
    };
  }, []);

  // Elapsed time from wall clock, not tick count: the JS thread is throttled in
  // the background and a tick-based timer would drift badly.
  useEffect(() => {
    if (state.status !== 'recording') return;
    const id = setInterval(() => {
      const now = Date.now();
      const paused = pausedAtRef.current;
      const base = paused != null ? paused : now;
      setState((prev) => ({ ...prev, elapsedMs: base - startedAtRef.current - pausedTotalRef.current }));
    }, 1000);
    return () => clearInterval(id);
  }, [state.status]);

  const updateWarning = useCallback(async () => {
    if (!(await Location.hasServicesEnabledAsync())) {
      setState((prev) => ({
        ...prev,
        warning: { kind: 'services-off', message: 'Location services are off. No points are being recorded.' },
      }));
      return;
    }
    setState((prev) => (prev.warning?.kind === 'services-off' ? { ...prev, warning: null } : prev));
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void updateWarning();
    });
    return () => sub.remove();
  }, [updateWarning]);

  const handleLocations = useCallback(async (location: Location.LocationObject) => {
    const session = await getActiveSession();
    if (!session) return;

    const { latitude, longitude, altitude, speed, accuracy } = location.coords;
    const timestamp = location.timestamp;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return;
    if (accuracy != null && accuracy > 65) {
      rejectedRef.current += 1;
      return;
    }

    const fresh: PersistedPoint[] = [
      {
        lat: latitude,
        lng: longitude,
        ele: altitude != null && Number.isFinite(altitude) ? altitude : null,
        t: Number.isFinite(timestamp) ? timestamp : Date.now(),
        speed: speed != null && Number.isFinite(speed) ? speed : null,
        acc: accuracy ?? null,
      },
    ];

    // Persist before touching state: a process kill between the two must lose
    // nothing, and storage is the source of truth the UI re-reads on recovery.
    await appendPoints(session.activityId, fresh);

    setState((prev) => {
      const all = [...prev.points, ...fresh];
      const { stats, rejected } = derive(all, rejectedRef.current);
      rejectedRef.current = rejected;
      return { ...prev, points: all, stats, rejectedPoints: rejected };
    });
  }, []);

  const start = useCallback(
    async (sportType: string) => {
      setState((prev) => ({ ...prev, status: 'acquiring' }));

      try {
        const servicesOn = await Location.hasServicesEnabledAsync();
        if (!servicesOn) {
          setState((prev) => ({
            ...prev,
            status: 'error',
            warning: { kind: 'services-off', message: 'Turn on location services to record an activity.' },
          }));
          return;
        }

        const foreground = await Location.requestForegroundPermissionsAsync();
        if (!foreground.granted) {
          setState((prev) => ({
            ...prev,
            status: 'error',
            warning: {
              kind: 'error',
              message: foreground.canAskAgain
                ? 'Location permission is required to record an activity.'
                : 'Location permission is blocked. Enable it in system Settings.',
            },
          }));
          return;
        }

        // Foreground first, then background. On Android 11+ the background
        // request opens system settings, so only ask once tracking is confirmed
        // working and the user has seen a foreground point arrive.
        const background = await Location.getBackgroundPermissionsAsync();

        const activityId = `pending-${Date.now()}`;
        const startedAt = Date.now();
        const session: ActiveSession = {
          activityId,
          sportType,
          startedAt,
          backgroundAllowed: background.granted,
        };
        await setActiveSession(session);
        await clearPoints(activityId);

        startedAtRef.current = startedAt;
        pausedAtRef.current = null;
        pausedTotalRef.current = 0;
        pointsRef.current = [];
        rejectedRef.current = 0;

        const accuracyTier = Location.Accuracy.High;

        await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
          accuracy: accuracyTier,
          distanceInterval: ACCURACY_TO_DISPLACEMENT_M[accuracyTier],
          timeInterval: 5000,
          showsBackgroundLocationIndicator: false,
          activityType: Location.ActivityType.Fitness,
          pausesUpdatesAutomatically: false,
          foregroundService: Platform.OS === 'android'
            ? {
                notificationTitle: 'Recording activity',
                notificationBody: 'Mock Strava is tracking your route in the background.',
                notificationColor: '#FC4C02',
              }
            : undefined,
        });

        // Foreground watcher gives the live map a faster feed than the
        // background task, which is batched and deferred.
        foregroundSubscription.current = await Location.watchPositionAsync(
          { accuracy: accuracyTier, distanceInterval: 5, timeInterval: 2000 },
          handleLocations,
        );

        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        setState((prev) => ({
          ...prev,
          status: 'recording',
          session,
          points: [],
          stats: computeStats([]),
          elapsedMs: 0,
          rejectedPoints: 0,
          warning: background.granted
            ? null
            : {
                kind: 'no-background',
                message: 'Background access not granted. Tracking will pause when you leave the app.',
              },
        }));
      } catch (error) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          warning: {
            kind: 'error',
            message: error instanceof Error ? error.message : 'Could not start recording.',
          },
        }));
      }
    },
    [handleLocations],
  );

  const stopWatching = useCallback(async () => {
    foregroundSubscription.current?.remove();
    foregroundSubscription.current = null;
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }
    } catch {
      // task was never started
    }
  }, []);

  const pause = useCallback(async () => {
    pausedAtRef.current = Date.now();
    foregroundSubscription.current?.remove();
    foregroundSubscription.current = null;
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }
    } catch {
      // already stopped
    }
    setState((prev) => ({ ...prev, status: 'paused' }));
  }, []);

  const resume = useCallback(async () => {
    if (pausedAtRef.current != null) {
      pausedTotalRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = null;
    }
    const session = await getActiveSession();
    if (!session) {
      setState((prev) => ({ ...prev, status: 'idle', session: null }));
      return;
    }

    const accuracyTier = Location.Accuracy.High;
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: accuracyTier,
      distanceInterval: ACCURACY_TO_DISPLACEMENT_M[accuracyTier],
      timeInterval: 5000,
      activityType: Location.ActivityType.Fitness,
      foregroundService: Platform.OS === 'android'
        ? {
            notificationTitle: 'Recording activity',
            notificationBody: 'Mock Strava is tracking your route in the background.',
            notificationColor: '#FC4C02',
          }
        : undefined,
    });
    foregroundSubscription.current = await Location.watchPositionAsync(
      { accuracy: accuracyTier, distanceInterval: 5, timeInterval: 2000 },
      handleLocations,
    );
    setState((prev) => ({ ...prev, status: 'recording' }));
  }, [handleLocations]);

  const stop = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'stopping' }));
    await stopWatching();
    await persist();
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    setState((prev) => ({
      ...prev,
      status: 'idle',
      elapsedMs: prev.session
        ? (pausedAtRef.current ?? Date.now()) - startedAtRef.current - pausedTotalRef.current
        : 0,
    }));
  }, [persist, stopWatching]);

  const discard = useCallback(async () => {
    await stopWatching();
    const session = await getActiveSession();
    if (session) await clearPoints(session.activityId);
    await clearActiveSession();
    pointsRef.current = [];
    rejectedRef.current = 0;
    startedAtRef.current = 0;
    pausedAtRef.current = null;
    pausedTotalRef.current = 0;
    setState(initialState);
  }, [stopWatching]);

  const takeBufferedPoints = useCallback(async () => {
    const session = await getActiveSession();
    if (!session) return [];
    await persist();
    const buffered = await readPoints(session.activityId);
    return buffered;
  }, [persist]);

  // Request background permission only after the user has recorded a little,
  // which is when the value of continued tracking becomes obvious.
  const requestBackground = useCallback(async (): Promise<boolean> => {
    const result = await Location.requestBackgroundPermissionsAsync();
    const granted = result.granted;
    const session = await getActiveSession();
    if (session) {
      const updated: ActiveSession = { ...session, backgroundAllowed: granted };
      await setActiveSession(updated);
    }
    setState((prev) => ({
      ...prev,
      session: prev.session ? { ...prev.session, backgroundAllowed: granted } : prev.session,
      warning: granted
        ? null
        : { kind: 'no-background', message: 'Background access declined. Tracking stops when you leave the app.' },
    }));
    return granted;
  }, []);

  const value = useMemo<TrackingState & TrackingActions>(
    () => ({ ...state, start, pause, resume, stop, discard, takeBufferedPoints, requestBackground }),
    [state, start, pause, resume, stop, discard, takeBufferedPoints, requestBackground],
  );

  return <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>;
}

export function useTracking() {
  const ctx = useContext(TrackingContext);
  if (!ctx) throw new Error('useTracking must be used inside <TrackingProvider>');
  return ctx;
}

export type { GeoPoint };
