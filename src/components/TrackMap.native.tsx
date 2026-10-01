import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import MapView, { Polyline, Marker, type Region } from 'react-native-maps';

import { theme } from '../theme/tokens';
import { boundsOf, centroidOf, type GeoPoint } from '../lib/geo';

interface Props {
  points: GeoPoint[];
  color?: string;
  /** Live recording: a pulsing dot on the newest point. */
  showCurrentMarker?: boolean;
  height?: number;
}

const FALLBACK_REGION: Region = {
  latitude: 37.7749,
  longitude: -122.4194,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

export function TrackMap({ points, color = theme.colors.orange, showCurrentMarker, height = 260 }: Props) {
  const region = useMemo<Region | null>(() => {
    const bounds = boundsOf(points);
    if (!bounds) return null;
    return {
      latitude: (bounds.minLat + bounds.maxLat) / 2,
      longitude: (bounds.minLng + bounds.maxLng) / 2,
      latitudeDelta: Math.max(0.002, bounds.maxLat - bounds.minLat),
      longitudeDelta: Math.max(0.002, bounds.maxLng - bounds.minLng),
    };
  }, [points]);

  const coordinates = useMemo(
    () => points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
    [points],
  );

  const last = points.length > 0 ? points[points.length - 1] : null;
  const origin = points[0] ?? null;
  const center = last ?? centroidOf(points);

  return (
    <MapView
      style={[styles.map, { height }]}
      initialRegion={region ?? FALLBACK_REGION}
      region={region ?? undefined}
      scrollEnabled={points.length > 1}
      pitchEnabled={false}
      rotateEnabled={false}
      showsUserLocation={false}
      showsCompass={false}
      toolbarEnabled={false}
      userInterfaceStyle="light"
    >
      {coordinates.length > 1 && (
        <Polyline coordinates={coordinates} strokeColor={color} strokeWidth={5} lineCap="round" lineJoin="round" />
      )}
      {origin != null && coordinates.length > 1 && (
        <Marker coordinate={coordinates[0]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View style={styles.startDot} />
        </Marker>
      )}
      {showCurrentMarker && last != null && center != null && (
        <Marker
          coordinate={{ latitude: last.lat, longitude: last.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View style={styles.currentHalo}>
            <View style={[styles.currentDot, { backgroundColor: color }]} />
          </View>
        </Marker>
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { width: '100%', borderRadius: theme.radius.md, overflow: 'hidden' },
  startDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.success,
    borderWidth: 2,
    borderColor: theme.colors.white,
  },
  currentHalo: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(252, 76, 2, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: theme.colors.white,
  },
});
