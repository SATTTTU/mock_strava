import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Line } from 'react-native-svg';

import { theme } from '../theme/tokens';

interface Props {
  values: (number | null)[];
  distance: number;
  height?: number;
  color?: string;
}

const W = 300;
const PAD = 2;

/** Elevation profile. Skipped when the OS reported no altitude data. */
export function ElevationProfile({ values, distance, height = 70, color = theme.colors.orange }: Props) {
  const path = useMemo(() => {
    const present = values.filter((v): v is number => v != null && Number.isFinite(v));
    if (present.length < 2) return null;

    const min = Math.min(...present);
    const max = Math.max(...present);
    const span = max - min || 1;
    const stepX = (W - PAD * 2) / Math.max(1, values.length - 1);

    let d = '';
    let penDown = false;

    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) {
        penDown = false;
        return;
      }
      const x = PAD + i * stepX;
      const y = height - PAD - ((v - min) / span) * (height - PAD * 2);
      d += `${penDown ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)} `;
      penDown = true;
    });

    return { d, min, max, presentCount: present.length };
  }, [values, height]);

  if (path == null) {
    return (
      <View style={[styles.placeholder, { height }]}>
        <View style={styles.placeholderBar} />
      </View>
    );
  }

  const km = (distance / 1000).toFixed(1);
  const gain = Math.round(Math.max(0, path.max - path.min));

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
        <Line x1={0} y1={height - 0.5} x2={W} y2={height - 0.5} stroke={theme.colors.line} strokeWidth={1} />
        <Path d={path.d} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
      <View style={styles.footer}>
        <Text style={styles.meta}>{km} km</Text>
        <Text style={styles.meta}>{path.presentCount} elevation points</Text>
        <Text style={styles.meta}>{gain} m range</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { justifyContent: 'center', paddingHorizontal: theme.space.md },
  placeholderBar: { height: 6, borderRadius: 3, backgroundColor: theme.colors.line },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.space.xs },
  meta: { fontSize: 11, color: theme.colors.muted },
});
