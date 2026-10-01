import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';

import { theme } from '../theme/tokens';
import { boundsOf, type GeoPoint } from '../lib/geo';

/**
 * Web fallback for TrackMap.
 *
 * react-native-maps has no web implementation: importing it on web throws
 * `codegenNativeComponent is not a function` at module load, which takes down
 * the whole route rather than just the map. So the web target gets a static SVG
 * of the route instead of an interactive map.
 *
 * That is enough to review layout and stats in a browser. It is not a
 * substitute for checking the map on a device, where the .native.tsx version
 * with a real MapView is what ships.
 */

interface Props {
  points: GeoPoint[];
  color?: string;
  showCurrentMarker?: boolean;
  height?: number;
}

const W = 320;
const H = 320;
const PAD = 14;

export function TrackMap({ points, color = theme.colors.orange, showCurrentMarker, height = 260 }: Props) {
  const geometry = useMemo(() => {
    const bounds = boundsOf(points, 1.15);
    if (!bounds || points.length < 2) return null;

    const spanLat = bounds.maxLat - bounds.minLat;
    const spanLng = bounds.maxLng - bounds.minLng;

    // A single axis can be zero when the route runs due north or due east.
    // Guard so the division below cannot produce Infinity, which would make the
    // whole path render as NaN.
    const safeSpanLat = spanLat > 1e-9 ? spanLat : 1e-9;
    const safeSpanLng = spanLng > 1e-9 ? spanLng : 1e-9;

    const innerW = W - PAD * 2;
    const innerH = H - PAD * 2;

    // Equirectangular projection scaled per axis so the route fills the box.
    // Mercator would be more accurate at high latitude but distorts shape, and
    // this is a preview rather than navigation.
    const scaleX = innerW / safeSpanLng;
    const scaleY = innerH / safeSpanLat;
    const scale = Math.max(scaleX, scaleY);

    const project = (p: GeoPoint) => ({
      // x east, y south: SVG y grows downward, latitude grows north.
      x: PAD + (p.lng - bounds.minLng) * scale + (innerW - safeSpanLng * scale) / 2,
      y: PAD + (bounds.maxLat - p.lat) * scale + (innerH - safeSpanLat * scale) / 2,
    });

    const projected = points.map(project);
    const d = projected
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(' ');

    return { d, projected };
  }, [points]);

  return (
    <View style={[styles.container, { height }]}>
      {geometry ? (
        <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
          <Path
            d={geometry.d}
            stroke={theme.colors.line}
            strokeWidth={8}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <Path
            d={geometry.d}
            stroke={color}
            strokeWidth={4}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <Circle
            cx={geometry.projected[0].x}
            cy={geometry.projected[0].y}
            r={6}
            fill={theme.colors.success}
            stroke={theme.colors.white}
            strokeWidth={2}
          />
          {showCurrentMarker && (
            <Circle
              cx={geometry.projected[geometry.projected.length - 1].x}
              cy={geometry.projected[geometry.projected.length - 1].y}
              r={6}
              fill={color}
              stroke={theme.colors.white}
              strokeWidth={2}
            />
          )}
        </Svg>
      ) : (
        <Text style={styles.placeholder}>
          {points.length < 2 ? 'Waiting for a route' : 'No route to draw'}
        </Text>
      )}
      <Text style={styles.banner}>route preview · map unavailable on web</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: theme.radius.md,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: { fontSize: 13, color: theme.colors.muted },
  banner: {
    position: 'absolute',
    bottom: 6,
    fontSize: 10,
    color: theme.colors.muted,
  },
});