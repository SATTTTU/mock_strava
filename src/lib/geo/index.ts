/**
 * Geodesy + GPS statistics. Pure functions only, no React, no Expo imports,
 * so they are unit-testable and can run identically on device and in Postgres
 * via a mirrored SQL implementation.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
  ele?: number | null;
  t?: number;
  speed?: number | null;
  accuracy?: number | null;
}

const EARTH_RADIUS_M = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Great-circle distance in metres (haversine). */
export function haversineDistance(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Android LocationRequest accuracy -> minimum displacement filter in metres.
 * Keeps battery sane without visibly cutting corners on the polyline.
 */
export const ACCURACY_TO_DISPLACEMENT_M: Record<number, number> = {
  0: 50, // none
  1: 20, // high
  2: 10, // balanced
  3: 5, // low
  4: 3, // high_passive
};

export interface FilterOptions {
  /** Reject fixes with accuracy worse than this (metres). */
  maxAccuracyM?: number;
  /** Drop a point if it implies a speed above this (m/s). GPS outliers. */
  maxSpeedMps?: number;
}

export interface ProcessedTrack {
  points: GeoPoint[];
  rejected: number;
}

const DEFAULT_FILTERS: Required<FilterOptions> = {
  maxAccuracyM: 50,
  maxSpeedMps: 12.5, // 45 km/h — above this a running/cycling fix is a glitch
};

/**
 * Clean a raw GPS stream: sort by time, drop poor-accuracy fixes, and reject
 * teleports implied by implausible speeds.
 *
 * Stationary points are deliberately KEPT even though they are duplicates.
 * They contribute no distance, but each one carries a timestamp, and those
 * timestamps are the only record that the user stood still. Drop them and a
 * three-minute traffic light silently becomes a three-minute run, inflating
 * both moving time and average pace. Sample-rate reduction is left to the
 * OS-level distanceInterval on the location request instead.
 */
export function filterTrack(raw: GeoPoint[], options: FilterOptions = {}): ProcessedTrack {
  const { maxAccuracyM, maxSpeedMps } = { ...DEFAULT_FILTERS, ...options };

  const sorted = [...raw]
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));

  const kept: GeoPoint[] = [];
  let rejected = 0;

  for (const point of sorted) {
    if (point.accuracy != null && point.accuracy > maxAccuracyM) {
      rejected += 1;
      continue;
    }

    if (kept.length === 0) {
      kept.push(point);
      continue;
    }

    const prev = kept[kept.length - 1];
    const segment = haversineDistance(prev, point);
    const dtS = ((point.t ?? 0) - (prev.t ?? 0)) / 1000;

    if (dtS > 0 && segment / dtS > maxSpeedMps) {
      rejected += 1;
      continue;
    }

    kept.push(point);
  }

  return { points: kept, rejected };
}

export interface TrackStats {
  distanceM: number;
  movingTimeS: number;
  elapsedTimeS: number;
  elevationGainM: number;
  elevationLossM: number;
  avgSpeedMps: number;
  maxSpeedMps: number;
  avgMovingSpeedMps: number;
  pointCount: number;
  /** Per-point instantaneous speed in m/s, aligned with points. */
  speeds: number[];
  /** Elevation series for the profile chart, aligned with points. */
  elevations: (number | null)[];
  /** Fraction of moving time spent stationary (traffic lights), 0..1. */
  stoppedRatio: number;
}

const MOVING_SPEED_THRESHOLD_MPS = 0.5;
const ELEVATION_NOISE_M = 1.0;

/**
 * Core stats. Moving time excludes segments where speed is below
 * MOVING_SPEED_THRESHOLD_MPS, matching how runners perceive "moving time".
 *
 * GeoPoint.t is epoch MILLISECONDS (matching Date.now() and every GPS SDK),
 * while every duration returned here is in SECONDS. The conversion happens
 * once, at the top of the segment loop, so a mix-up cannot silently produce a
 * 1000x error in a speed.
 */
export function computeStats(points: GeoPoint[]): TrackStats {
  const distanceM = haversineLength(points);
  const elevationGainM = totalElevationGain(points, ELEVATION_NOISE_M);
  const elevationLossM = totalElevationLoss(points, ELEVATION_NOISE_M);
  const elapsedTimeS =
    points.length >= 2 ? ((points[points.length - 1].t ?? 0) - (points[0].t ?? 0)) / 1000 : 0;

  const speeds: number[] = new Array(points.length).fill(0);
  let movingTimeS = 0;
  let stoppedTimeS = 0;
  let maxSpeedMps = 0;
  let distanceAtSpeedChange = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dtS = ((b.t ?? 0) - (a.t ?? 0)) / 1000;
    const segment = haversineDistance(a, b);

    if (dtS <= 0) {
      speeds[i] = 0;
      continue;
    }

    const speed = segment / dtS;
    speeds[i] = speed;
    if (speed > maxSpeedMps) maxSpeedMps = speed;

    if (speed >= MOVING_SPEED_THRESHOLD_MPS) {
      movingTimeS += dtS;
      distanceAtSpeedChange = 0;
    } else {
      stoppedTimeS += dtS;
      distanceAtSpeedChange += segment;
    }
  }

  const movingDistance = Math.max(0, distanceM - distanceAtSpeedChange);
  const avgSpeedMps = elapsedTimeS > 0 ? distanceM / elapsedTimeS : 0;
  const avgMovingSpeedMps = movingTimeS > 0 ? movingDistance / movingTimeS : 0;

  return {
    distanceM,
    movingTimeS,
    elapsedTimeS,
    elevationGainM,
    elevationLossM,
    avgSpeedMps,
    maxSpeedMps,
    avgMovingSpeedMps,
    pointCount: points.length,
    speeds,
    elevations: points.map((p) => p.ele ?? null),
    stoppedRatio: elapsedTimeS > 0 ? stoppedTimeS / elapsedTimeS : 0,
  };
}

/** Cumulative distance from start for each point, in metres. */
export function cumulativeDistance(points: GeoPoint[]): number[] {
  const out = new Array<number>(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    out[i] = out[i - 1] + haversineDistance(points[i - 1], points[i]);
  }
  return out;
}

export function haversineLength(points: GeoPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistance(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Elevation gain with a noise threshold, so GPS barometer jitter does not
 * inflate the number. Only sustained rises count.
 */
export function totalElevationGain(points: GeoPoint[], noiseThresholdM = 1.0): number {
  let gain = 0;
  let anchor: number | null = null;

  for (const p of points) {
    if (p.ele == null) continue;
    if (anchor == null) {
      anchor = p.ele;
      continue;
    }
    if (p.ele - anchor > noiseThresholdM) {
      gain += p.ele - anchor;
      anchor = p.ele;
    } else if (p.ele < anchor) {
      anchor = p.ele;
    }
  }
  return gain;
}

export function totalElevationLoss(points: GeoPoint[], noiseThresholdM = 1.0): number {
  let loss = 0;
  let anchor: number | null = null;

  for (const p of points) {
    if (p.ele == null) continue;
    if (anchor == null) {
      anchor = p.ele;
      continue;
    }
    if (anchor - p.ele > noiseThresholdM) {
      loss += anchor - p.ele;
      anchor = p.ele;
    } else if (p.ele > anchor) {
      anchor = p.ele;
    }
  }
  return loss;
}

export interface Bounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Map region that fits all points, with padding, for react-native-maps fitToCoordinates. */
export function boundsOf(points: GeoPoint[], padding = 1.35): Bounds | null {
  if (points.length === 0) return null;

  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;

  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const padLat = (maxLat - minLat) * padding;
  const padLng = (maxLng - minLng) * padding;

  return {
    minLat: minLat - padLat / 2,
    maxLat: maxLat + padLat / 2,
    minLng: minLng - padLng / 2,
    maxLng: maxLng + padLng / 2,
  };
}

export function centroidOf(points: GeoPoint[]): { lat: number; lng: number } | null {
  if (points.length === 0) return null;
  const sum = points.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

/**
 * Dead-reckoning interpolation between two GPS fixes, used to fill straight
 * gaps (tunnels, tree cover) so the polyline does not cut across buildings.
 */
export function interpolateGap(a: GeoPoint, b: GeoPoint, stepM = 10): GeoPoint[] {
  const gap = haversineDistance(a, b);
  if (gap <= stepM) return [];

  const steps = Math.min(500, Math.floor(gap / stepM));
  const out: GeoPoint[] = [];

  for (let i = 1; i < steps; i++) {
    const f = i / steps;
    out.push({
      lat: a.lat + (b.lat - a.lat) * f,
      lng: a.lng + (b.lng - a.lng) * f,
      ele: (a.ele ?? 0) + ((b.ele ?? 0) - (a.ele ?? 0)) * f,
      t: Math.round((a.t ?? 0) + ((b.t ?? 0) - (a.t ?? 0)) * f),
    });
  }
  return out;
}

export function degreesToMetres(lat: number, deltaLat: number, deltaLng: number) {
  const mPerDegLat = 111_132.92 - 559.82 * Math.cos(2 * lat * DEG_TO_RAD) + 1.175 * Math.cos(4 * lat * DEG_TO_RAD);
  const mPerDegLng = 111_412.84 * Math.cos(lat * DEG_TO_RAD) - 93.5 * Math.cos(3 * lat * DEG_TO_RAD);
  return {
    north: deltaLat * mPerDegLat,
    east: deltaLng * mPerDegLng,
  };
}

export { EARTH_RADIUS_M, MOVING_SPEED_THRESHOLD_MPS, RAD_TO_DEG };
