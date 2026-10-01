const { computeStats, filterTrack, haversineDistance, haversineLength, totalElevationGain, boundsOf, cumulativeDistance, interpolateGap } = require('../src/lib/geo');
const { parseGpx, toGpx } = require('../src/lib/geo/gpx');
const { formatDistance, formatDuration, formatPace, formatSpeed, formatStopwatch } = require('../src/lib/format');

const p = (lat, lng, ele, t) => ({ lat, lng, ele, t });

describe('haversineDistance', () => {
  it('is zero for identical points', () => {
    expect(haversineDistance(p(51.5, -0.12), p(51.5, -0.12))).toBe(0);
  });

  it('matches a known long-distance pair (London to Paris, ~343 km)', () => {
    const d = haversineDistance(p(51.5074, -0.1278), p(48.8566, 2.3522));
    expect(d / 1000).toBeGreaterThan(340);
    expect(d / 1000).toBeLessThan(346);
  });

  it('is symmetric', () => {
    const a = p(40.7128, -74.006);
    const b = p(34.0522, -118.2437);
    expect(haversineDistance(a, b)).toBeCloseTo(haversineDistance(b, a), 6);
  });

  it('scales linearly with a known delta', () => {
    const one = haversineDistance(p(0, 0), p(0, 1));
    const two = haversineDistance(p(0, 0), p(0, 2));
    expect(two / one).toBeCloseTo(2, 3);
  });
});

describe('filterTrack', () => {
  it('keeps every point of a clean, well-spaced track', () => {
    const points = [p(51.5, -0.12, 10, 1000), p(51.5001, -0.12, 11, 2000), p(51.5002, -0.12, 12, 3000)];
    const result = filterTrack(points);
    expect(result.points).toHaveLength(3);
    expect(result.rejected).toBe(0);
  });

  it('never returns more points than it was given', () => {
    const points = Array.from({ length: 200 }, (_, i) => p(51.5 + i * 0.0001, -0.12, 10 + i * 0.01, 1000 + i * 1000));
    expect(filterTrack(points).points.length).toBeLessThanOrEqual(points.length);
  });

  it('drops fixes with accuracy worse than the threshold', () => {
    const points = [
      { lat: 51.5, lng: -0.12, t: 1000, accuracy: 5 },
      { lat: 51.5001, lng: -0.12, t: 2000, accuracy: 500 },
      { lat: 51.5002, lng: -0.12, t: 3000, accuracy: 5 },
    ];
    const result = filterTrack(points);
    expect(result.points).toHaveLength(2);
    expect(result.rejected).toBe(1);
  });

  it('keeps stationary points so a stop is not silently deleted', () => {
    // Dropping these would turn a 3-minute traffic light into 0 seconds of
    // stopped time and inflate average pace.
    const points = [p(51.5, -0.12, 10, 1000), p(51.5, -0.12, 10, 2000), p(51.5, -0.12, 10, 3000)];
    expect(filterTrack(points).points).toHaveLength(3);
  });

  it('rejects a GPS teleport that implies an impossible speed', () => {
    const points = [p(51.5, -0.12, 10, 1_000_000), p(51.9, -0.12, 10, 1_001_000)];
    const result = filterTrack(points);
    expect(result.points).toHaveLength(1);
    expect(result.rejected).toBe(1);
  });

  it('sorts out-of-order input by timestamp', () => {
    const result = filterTrack([p(51.5002, -0.12, 10, 3000), p(51.5, -0.12, 10, 1000)]);
    expect(result.points[0].t).toBe(1000);
  });

  it('handles an empty array without throwing', () => {
    expect(filterTrack([]).points).toEqual([]);
  });
});

describe('computeStats', () => {
  it('returns zeroed stats for an empty track', () => {
    const s = computeStats([]);
    expect(s.distanceM).toBe(0);
    expect(s.pointCount).toBe(0);
    expect(Number.isFinite(s.avgSpeedMps)).toBe(true);
  });

  it('handles a single point', () => {
    const s = computeStats([p(51.5, -0.12, 10, 1000)]);
    expect(s.distanceM).toBe(0);
    expect(s.elapsedTimeS).toBe(0);
  });

  it('computes elapsed time from first to last timestamp', () => {
    const s = computeStats([p(51.5, -0.12, 10, 1000), p(51.6, -0.12, 10, 301_000)]);
    expect(s.elapsedTimeS).toBe(300);
  });

  it('excludes stationary time from moving time', () => {
    // Run ~100 m, then stand still for 5 minutes at the same spot.
    const points = [
      p(51.5, -0.12, 10, 0),
      p(51.5009, -0.12, 10, 10_000),
      p(51.5009, -0.12, 10, 310_000),
    ];
    const s = computeStats(points);
    expect(s.elapsedTimeS).toBe(310);
    expect(s.movingTimeS).toBe(10);
    expect(s.stoppedRatio).toBeCloseTo(300 / 310, 2);
  });

  it('counts sustained movement as moving time', () => {
    // ~100 m over 10 s is 10 m/s, well above the moving threshold.
    const s = computeStats([p(51.5, -0.12, 10, 0), p(51.5009, -0.12, 10, 10_000)]);
    expect(s.movingTimeS).toBe(10);
    expect(s.stoppedRatio).toBe(0);
  });

  it('reports a plausible speed for a jog, not a thousand times too fast', () => {
    // 0.001 deg of latitude is ~111 m. Over 60 s that is ~1.85 m/s (~6.7 km/h),
    // a real running pace. This is the regression test for the ms/s mix-up.
    const s = computeStats([p(51.5, -0.12, 10, 0), p(51.501, -0.12, 10, 60_000)]);
    expect(s.avgMovingSpeedMps).toBeGreaterThan(1.5);
    expect(s.avgMovingSpeedMps).toBeLessThan(2.5);
  });

  it('reports zero elevation gain for a flat track despite GPS jitter', () => {
    const points = [
      p(51.5, -0.12, 100.0, 0),
      p(51.5005, -0.12, 100.4, 1000),
      p(51.501, -0.12, 99.6, 2000),
      p(51.5015, -0.12, 100.3, 3000),
    ];
    expect(totalElevationGain(points, 1.0)).toBe(0);
  });

  it('counts a sustained climb', () => {
    const points = [
      p(51.5, -0.12, 100, 0),
      p(51.5005, -0.12, 110, 1000),
      p(51.501, -0.12, 120, 2000),
    ];
    expect(totalElevationGain(points, 1.0)).toBe(20);
  });

  it('never reports a negative distance', () => {
    expect(computeStats([p(51.5, -0.12, 10, 1000)]).distanceM).toBeGreaterThanOrEqual(0);
  });

  it('emits one speed and one elevation per point', () => {
    const points = [p(51.5, -0.12, 10, 0), p(51.5005, -0.12, 20, 5000), p(51.501, -0.12, 30, 10_000)];
    const s = computeStats(points);
    expect(s.speeds).toHaveLength(points.length);
    expect(s.elevations).toHaveLength(points.length);
  });
});

describe('cumulativeDistance', () => {
  it('is monotonic and starts at zero', () => {
    const points = [p(51.5, -0.12, 10, 0), p(51.5005, -0.12, 10, 1000), p(51.501, -0.12, 10, 2000)];
    const cumulative = cumulativeDistance(points);
    expect(cumulative[0]).toBe(0);
    expect(cumulative[1]).toBeLessThan(cumulative[2]);
  });
});

describe('haversineLength', () => {
  it('equals the sum of consecutive segments', () => {
    const points = [p(51.5, -0.12, 10, 0), p(51.5005, -0.12, 10, 1000), p(51.501, -0.12, 10, 2000)];
    const manual =
      haversineDistance(points[0], points[1]) + haversineDistance(points[1], points[2]);
    expect(haversineLength(points)).toBeCloseTo(manual, 6);
  });
});

describe('boundsOf', () => {
  it('returns null for no points', () => {
    expect(boundsOf([])).toBeNull();
  });

  it('contains every point within the returned bounds', () => {
    const points = [p(51.5, -0.12, 10, 0), p(51.6, -0.05, 10, 1000), p(51.55, -0.09, 10, 2000)];
    const b = boundsOf(points);
    for (const point of points) {
      expect(point.lat).toBeGreaterThanOrEqual(b.minLat);
      expect(point.lat).toBeLessThanOrEqual(b.maxLat);
      expect(point.lng).toBeGreaterThanOrEqual(b.minLng);
      expect(point.lng).toBeLessThanOrEqual(b.maxLng);
    }
  });
});

describe('interpolateGap', () => {
  it('returns nothing for a short gap', () => {
    expect(interpolateGap(p(51.5, -0.12, 10, 0), p(51.50001, -0.12, 10, 1000))).toEqual([]);
  });

  it('fills a long gap with points inside the endpoints', () => {
    const a = p(51.5, -0.12, 10, 0);
    const b = p(51.52, -0.12, 20, 60000);
    const filled = interpolateGap(a, b, 50);
    expect(filled.length).toBeGreaterThan(0);
    for (const point of filled) {
      expect(point.lat).toBeGreaterThanOrEqual(a.lat);
      expect(point.lat).toBeLessThanOrEqual(b.lat);
      expect(point.t).toBeGreaterThanOrEqual(a.t);
      expect(point.t).toBeLessThanOrEqual(b.t);
    }
  });
});

describe('parseGpx', () => {
  const validGpx = `<?xml version="1.0"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Morning Run</name>
    <type>run</type>
    <trkseg>
      <trkpt lat="51.5000" lon="-0.1200"><ele>10.0</ele><time>2026-01-01T08:00:00.000Z</time></trkpt>
      <trkpt lat="51.5010" lon="-0.1200"><ele>12.0</ele><time>2026-01-01T08:00:30.000Z</time></trkpt>
      <trkpt lat="51.5020" lon="-0.1200"><ele>14.0</ele><time>2026-01-01T08:01:00.000Z</time></trkpt>
    </trkseg>
  </trk>
</gpx>`;

  it('parses name, sport, and points', () => {
    const track = parseGpx(validGpx);
    expect(track.name).toBe('Morning Run');
    expect(track.sport).toBe('run');
    expect(track.points).toHaveLength(3);
    expect(track.points[0].lat).toBeCloseTo(51.5, 5);
  });

  it('computes stats for a parsed track', () => {
    const track = parseGpx(validGpx);
    expect(track.stats.distanceM).toBeGreaterThan(0);
    expect(track.stats.elapsedTimeS).toBe(60);
  });

  it('rejects input that is not GPX', () => {
    expect(() => parseGpx('<html><body>nope</body></html>')).toThrow(/GPX/);
  });

  it('rejects a track with fewer than two points', () => {
    const single = validGpx.replace(/<trkpt lat="51.5010".*?<\/trkpt>/s, '').replace(/<trkpt lat="51.5020".*?<\/trkpt>/s, '');
    expect(() => parseGpx(single)).toThrow();
  });

  it('skips points with out-of-range coordinates', () => {
    const bad = validGpx.replace('lat="51.5020"', 'lat="99.9"');
    const track = parseGpx(bad);
    expect(track.points).toHaveLength(2);
  });

  it('falls back to the supplied sport when <type> is missing or unknown', () => {
    const noType = validGpx.replace('<type>run</type>', '<type>spaceship</type>');
    expect(parseGpx(noType, 'ride').sport).toBe('ride');
  });

  it('still parses a file that has no timestamps, and flags the times as synthetic', () => {
    const noTime = validGpx.replace(/<time>.*?<\/time>/g, '');
    const track = parseGpx(noTime);
    expect(track.timesSynthesised).toBe(true);
    expect(track.points.every((pt) => Number.isFinite(pt.t))).toBe(true);
    // Distance is exact even without timestamps.
    expect(track.stats.distanceM).toBeGreaterThan(0);
  });

  it('does not flag synthetic times on a normal file', () => {
    expect(parseGpx(validGpx).timesSynthesised).toBe(false);
  });

  it('round-trips through toGpx', () => {
    const original = parseGpx(validGpx);
    const xml = toGpx(original.points, 'Re-run', 'run');
    const reparsed = parseGpx(xml);
    expect(reparsed.name).toBe('Re-run');
    expect(reparsed.points).toHaveLength(original.points.length);
  });

  it('escapes XML metacharacters in a track name', () => {
    const tricky = validGpx.replace('Morning Run', 'A & B <script>');
    expect(() => parseGpx(tricky)).not.toThrow();
    const xml = toGpx([p(51.5, -0.12, 10, 0), p(51.501, -0.12, 10, 1000)], 'A & B', 'run');
    expect(xml).toContain('&amp;');
    expect(xml).not.toContain('A & B <');
  });
});

describe('formatters', () => {
  it('formats distance in km', () => {
    expect(formatDistance(5000)).toBe('5.00 km');
    expect(formatDistance(0)).toBe('0.00 km');
  });

  it('formats short distances as feet in imperial mode', () => {
    expect(formatDistance(100, { imperial: true })).toContain('ft');
  });

  it('formats durations with and without hours', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3665)).toBe('1:01:05');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(-5)).toBe('0:00');
  });

  it('always shows hours on the recording clock', () => {
    expect(formatStopwatch(3665)).toBe('1:01:05');
    expect(formatStopwatch(5)).toBe('0:00:05');
  });

  it('formats pace in min/km and refuses meaningless values', () => {
    expect(formatPace(1000, 300)).toBe('5:00');
    expect(formatPace(10, 300)).toBe('—');
    expect(formatPace(1000, 0)).toBe('—');
  });

  it('formats speed in km/h', () => {
    expect(formatSpeed(10)).toBe('36.0 km/h');
    expect(formatSpeed(0)).toBe('0.0 km/h');
    expect(formatSpeed(10, { imperial: true })).toBe('22.4 mph');
  });

  it('never returns NaN for non-finite input', () => {
    // Each formatter has its own sensible zero, so assert them individually.
    expect(formatDistance(NaN)).toBe('0');
    expect(formatDistance(Infinity)).toBe('0');
    expect(formatDuration(NaN)).toBe('0:00');
    expect(formatDuration(Infinity)).toBe('0:00');
    expect(formatSpeed(NaN)).toBe('0.0 km/h');
    expect(formatPace(1000, NaN)).toBe('—');
  });
});
