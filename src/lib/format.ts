/** Distance/pace/speed formatting. Strava conventions: km, m/km, km/h. */

const KM_PER_M = 0.001;

export function formatDistance(metres: number, opts: { imperial?: boolean } = {}): string {
  if (!Number.isFinite(metres)) return '0';
  if (opts.imperial) {
    const miles = metres / 1609.344;
    return miles < 0.1 ? `${Math.round(metres * 3.28084)} ft` : `${miles.toFixed(2)} mi`;
  }
  return `${(metres * KM_PER_M).toFixed(2)} km`;
}

export function formatElevation(metres: number, opts: { imperial?: boolean } = {}): string {
  if (opts.imperial) return `${Math.round(metres * 3.28084)} ft`;
  return `${Math.round(metres)} m`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const s = Math.floor(seconds % 60);
  const totalMinutes = Math.floor(seconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);

  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

/** Live recording clock: always H:MM:SS. */
export function formatStopwatch(seconds: number): string {
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Pace in min/km, or empty string for non-distance sports. */
export function formatPace(metres: number, seconds: number): string {
  if (metres < 100 || seconds <= 0) return '—';
  const secPerKm = seconds / (metres * KM_PER_M);
  if (!Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '—';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatSpeed(mps: number, opts: { imperial?: boolean } = {}): string {
  if (!Number.isFinite(mps) || mps <= 0) return '0.0 km/h';
  if (opts.imperial) return `${(mps * 2.23694).toFixed(1)} mph`;
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffS = Math.round((Date.now() - then) / 1000);

  if (diffS < 60) return 'just now';
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
  ];

  let chosen: [number, Intl.RelativeTimeFormatUnit] = units[0];
  for (const u of units) if (diffS >= u[0]) chosen = u;

  const value = Math.round(diffS / chosen[0]);
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-value, chosen[1]);
}

export const SPORT_LABELS: Record<string, string> = {
  run: 'Run',
  ride: 'Ride',
  hike: 'Hike',
  walk: 'Walk',
};

export const SPORT_ICONS: Record<string, string> = {
  run: '\u{1F3C3}',
  ride: '\u{1F6B4}',
  hike: '\u{1F97E}',
  walk: '\u{1F6B6}',
};
