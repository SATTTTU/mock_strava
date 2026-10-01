/**
 * Minimal, dependency-free GPX 1.1 reader.
 *
 * Scope is deliberately narrow: `<trkpt lat lon><ele>` and `<time>` only.
 * That is all this app's own recorder emits, and it is enough to import
 * files from Strava/Garmin exports for development and testing.
 *
 * Not a general XML parser — no DTDs, no entities beyond the standard five,
 * no namespaces beyond ignoring them. Anything else is rejected rather than
 * guessed at.
 */

import { z } from 'zod';
import { filterTrack, computeStats, type GeoPoint } from './index';
import { sportTypeSchema, type SportType } from '../validation/schemas';

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const trkptSchema = z
  .string()
  .regex(/lat="(-?\d+(?:\.\d+)?)"\s+lon="(-?\d+(?:\.\d+)?)"/)
  .transform((s) => {
    const m = s.match(/lat="(-?\d+(?:\.\d+)?)"\s+lon="(-?\d+(?:\.\d+)?)"/)!;
    return { lat: Number(m[1]), lng: Number(m[2]) } as const;
  });

const timeSchema = z.string().transform((s) => new Date(s).getTime()).pipe(z.number());

export interface GpxTrack {
  name: string | null;
  sport: SportType;
  points: GeoPoint[];
  stats: ReturnType<typeof computeStats>;
  /**
   * True when the file had no <time> elements and a synthetic cadence was
   * substituted. Distance and elevation are exact; every time and speed is a
   * conservative lower bound and must not be shown as a measured value.
   */
  timesSynthesised: boolean;
}

/** Decode XML entities we can safely support without pulling in a full parser. */
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

export function parseGpx(xml: string, fallbackSport: SportType = 'run'): GpxTrack {
  if (xml.length > MAX_FILE_BYTES) {
    throw new Error('GPX file is too large (max 25 MB)');
  }
  if (!/<gpx[\s>]/i.test(xml)) {
    throw new Error('Not a GPX file: missing <gpx> root element');
  }

  const nameMatch = /<trk>[\s\S]*?<name>([\s\S]*?)<\/name>/i.exec(xml);
  const name = nameMatch ? decodeEntities(nameMatch[1].trim()).slice(0, 200) : null;

  const points: GeoPoint[] = [];
  const trkptRe = /<trkpt\b([^>]*)(?:\/>|>([\s\S]*?)<\/trkpt>)/gi;

  let m: RegExpExecArray | null;
  while ((m = trkptRe.exec(xml)) != null) {
    const attrs = m[1];
    const body = m[2] ?? '';

    const coord = trkptSchema.safeParse(attrs.trim());
    if (!coord.success) continue;

    const { lat, lng } = coord.data;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;

    const eleMatch = /<ele>([\s\S]*?)<\/ele>/i.exec(body);
    const ele = eleMatch ? Number.parseFloat(eleMatch[1]) : null;
    const timeMatch = /<time>([\s\S]*?)<\/time>/i.exec(body);
    const t = timeMatch ? timeSchema.safeParse(timeMatch[1].trim()) : null;

    points.push({
      lat,
      lng,
      ele: ele != null && Number.isFinite(ele) ? ele : null,
      t: t?.success ? t.data : undefined,
      speed: null,
      accuracy: null,
    });
  }

  if (points.length < 2) {
    throw new Error('GPX file has fewer than 2 valid track points');
  }

  // Some devices omit <time>. Distance and elevation are still exact, but
  // duration is unknowable, so we synthesise a deliberately CONSERVATIVE
  // cadence: 60 s per point against a real sampling rate of 1-10 s. This makes
  // every derived speed and time a lower bound rather than an invention, and
  // keeps the implied speed under the glitch threshold in filterTrack instead of
  // having the whole track rejected as physically impossible.
  const NO_TIME_CADENCE_MS = 60_000;
  const ordered =
    points[0].t == null ? points.map((p, i) => ({ ...p, t: i * NO_TIME_CADENCE_MS })) : points;

  const filtered = filterTrack(ordered);
  if (filtered.points.length < 2) {
    throw new Error('GPX track failed accuracy filtering (too few usable points)');
  }

  const typeMatch = /<type>([\s\S]*?)<\/type>/i.exec(xml);
  const parsedSport = typeMatch ? sportTypeSchema.safeParse(typeMatch[1].trim().toLowerCase()) : null;

  return {
    name,
    sport: parsedSport?.success ? parsedSport.data : fallbackSport,
    points: filtered.points,
    stats: computeStats(filtered.points),
    timesSynthesised: points[0].t == null,
  };
}

/** Serialise a track back to GPX 1.1 for export/sharing. */
export function toGpx(points: GeoPoint[], name: string, sport: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const trkpts = points
    .map((p) => {
      const t = p.t != null ? `<time>${new Date(p.t).toISOString()}</time>` : '';
      const e = p.ele != null ? `<ele>${p.ele.toFixed(2)}</ele>` : '';
      return `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">${e}${t}</trkpt>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MockStrava" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escape(name)}</name>
    <type>${escape(sport)}</type>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}
