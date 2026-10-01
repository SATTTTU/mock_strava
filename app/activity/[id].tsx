import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, Platform } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';

import { supabase } from '../../src/lib/supabase/client';
import { useActivityPoints, useCurrentUserId, useDeleteActivity, useUpdateActivity, queryKeys } from '../../src/lib/supabase/queries';
import { activitySchema, type Activity } from '../../src/lib/validation/schemas';
import { toGpx } from '../../src/lib/geo/gpx';
import { theme } from '../../src/theme/tokens';
import { TrackMap } from '../../src/components/TrackMap';
import { ElevationProfile } from '../../src/components/ElevationProfile';
import { StatGrid, SportBadge, VisibilityBadge, ErrorState } from '../../src/components/common';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import {
  SPORT_LABELS,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatElevation,
  formatPace,
  formatSpeed,
} from '../../src/lib/format';

const ACTIVITY_COLUMNS =
  'id, user_id, title, sport_type, visibility, started_at, distance_m, moving_time_s, elapsed_time_s, elevation_gain_m, avg_speed_mps, max_speed_mps, point_count, created_at';

const VISIBILITIES = ['public', 'followers', 'private'] as const;

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const userId = useCurrentUserId();
  const activityId = typeof id === 'string' ? id : '';

  const activity = useQuery({
    queryKey: queryKeys.activityDetail(activityId),
    enabled: !!activityId,
    queryFn: async (): Promise<Activity> => {
      const { data, error } = await supabase
        .from('activities')
        .select(ACTIVITY_COLUMNS)
        .eq('id', activityId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data == null) throw new Error('This activity no longer exists');
      return activitySchema.parse(data);
    },
  });

  const points = useActivityPoints(activityId);
  const updateActivity = useUpdateActivity();
  const deleteActivity = useDeleteActivity();

  const isOwner = !!userId && activity.data?.user_id === userId;
  const isRide = activity.data?.sport_type === 'ride';
  const sportColor = theme.sport[activity.data?.sport_type ?? 'run'] ?? theme.colors.orange;

  const geoPoints = useMemo(
    () =>
      (points.data ?? []).map((p) => ({ lat: p.lat, lng: p.lng, ele: p.ele, t: p.t })),
    [points.data],
  );

  function onDelete() {
    if (!activity.data) return;
    Alert.alert('Delete activity?', 'The track and all of its data will be permanently removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteActivity.mutate(activity.data!.id, {
            onSuccess: () => router.replace('/(tabs)/activities'),
          });
        },
      },
    ]);
  }

  async function onExport() {
    const current = activity.data;
    if (!current || geoPoints.length < 2) return;
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert('Sharing unavailable', 'GPX export needs a development build on a physical device.');
      return;
    }
    try {
      const xml = toGpx(geoPoints, current.title, current.sport_type);
      const safeName = current.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40);
      const path = `${FileSystem.cacheDirectory}${safeName || 'activity'}.gpx`;
      await FileSystem.writeAsStringAsync(path, xml, { encoding: 'utf8' });
      await Sharing.shareAsync(path, { mimeType: 'application/gpx+xml', UTI: 'public.xml' });
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Could not export this activity.');
    }
  }

  if (activity.isPending) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Activity' }} />
        <View style={styles.center}>
          <Text style={styles.muted}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (activity.isError) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Activity' }} />
        <ErrorState message={activity.error.message} onRetry={() => void activity.refetch()} />
      </SafeAreaView>
    );
  }

  const a = activity.data!;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: a.title }} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <SportBadge sport={a.sport_type} />
          <VisibilityBadge visibility={a.visibility} />
        </View>

        <Text style={styles.title}>{a.title}</Text>
        <Text style={styles.meta}>
          {formatDateTime(a.started_at)} · {SPORT_LABELS[a.sport_type] ?? a.sport_type}
        </Text>

        {geoPoints.length > 1 ? (
          <TrackMap points={geoPoints} color={sportColor} height={300} />
        ) : (
          <View style={styles.mapPlaceholder}>
            <Text style={styles.muted}>
              {points.isPending ? 'Loading track…' : 'No track points for this activity'}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <StatGrid
            stats={[
              { label: 'Distance', value: formatDistance(a.distance_m) },
              { label: 'Moving time', value: formatDuration(a.moving_time_s) },
              { label: 'Elapsed', value: formatDuration(a.elapsed_time_s) },
              { label: 'Elev gain', value: formatElevation(a.elevation_gain_m) },
              {
                label: isRide ? 'Avg speed' : 'Avg pace',
                value: isRide ? formatSpeed(a.avg_speed_mps) : formatPace(a.distance_m, a.moving_time_s),
              },
              { label: 'Max speed', value: formatSpeed(a.max_speed_mps) },
            ]}
          />
          <Text style={styles.footnote}>
            Distances and times are recalculated on the server from your raw GPS points.
          </Text>
        </View>

        {geoPoints.length > 1 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Elevation</Text>
            <ElevationProfile values={geoPoints.map((p) => p.ele ?? null)} distance={a.distance_m} color={sportColor} />
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Details</Text>
          <DetailRow label="GPS points" value={String(a.point_count)} />
          <DetailRow label="Visibility" value={a.visibility} />
        </View>

        {isOwner && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Manage</Text>
            <View style={styles.visibilityRow}>
              {VISIBILITIES.map((v) => {
                const selected = v === a.visibility;
                return (
                  <Pressable
                    key={v}
                    onPress={() => updateActivity.mutate({ id: a.id, visibility: v })}
                    disabled={updateActivity.isPending}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={[styles.visibilityChip, selected && styles.visibilityChipActive]}
                  >
                    <Text style={[styles.visibilityText, selected && styles.visibilityTextActive]}>{v}</Text>
                  </Pressable>
                );
              })}
            </View>
            {updateActivity.isError && (
              <Text style={styles.error}>{updateActivity.error.message}</Text>
            )}

            <PrimaryButton
              title="Export GPX"
              onPress={() => void onExport()}
              variant="secondary"
              disabled={geoPoints.length < 2}
              style={Platform.OS === 'android' ? undefined : undefined}
            />
            <PrimaryButton title="Delete activity" onPress={onDelete} variant="danger" />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surfaceAlt },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: theme.space.lg, gap: theme.space.md, paddingBottom: theme.space.xxl },
  headerRow: { flexDirection: 'row', gap: theme.space.sm, alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: theme.colors.ink },
  meta: { fontSize: 13, color: theme.colors.muted, marginTop: -theme.space.xs },
  mapPlaceholder: {
    height: 300,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  cardTitle: { fontSize: 13, fontWeight: '700', color: theme.colors.inkSoft },
  footnote: { fontSize: 11, color: theme.colors.muted, lineHeight: 16 },
  muted: { color: theme.colors.muted },
  error: { fontSize: 13, color: theme.colors.danger },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: theme.space.xs },
  detailLabel: { fontSize: 14, color: theme.colors.inkSoft },
  detailValue: { fontSize: 14, fontWeight: '600', color: theme.colors.ink },
  visibilityRow: { flexDirection: 'row', gap: theme.space.sm, flexWrap: 'wrap' },
  visibilityChip: {
    paddingHorizontal: theme.space.md,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.line,
    minHeight: 40,
    justifyContent: 'center',
  },
  visibilityChipActive: { backgroundColor: theme.colors.orange, borderColor: theme.colors.orange },
  visibilityText: { fontSize: 13, fontWeight: '600', color: theme.colors.inkSoft },
  visibilityTextActive: { color: theme.colors.white },
});
