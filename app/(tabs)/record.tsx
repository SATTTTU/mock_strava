import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { useTracking } from '../../src/features/tracking/TrackingContext';
import { toGeoPoints } from '../../src/features/tracking/localStore';
import { saveActivity } from '../../src/features/tracking/saveActivity';
import { TrackMap } from '../../src/components/TrackMap';
import { StatGrid, EmptyState, ErrorState } from '../../src/components/common';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { theme } from '../../src/theme/tokens';
import { SPORT_LABELS, formatDistance, formatDuration, formatPace, formatSpeed, formatStopwatch } from '../../src/lib/format';

const SPORTS = ['run', 'ride', 'hike', 'walk'] as const;

export default function RecordScreen() {
  const router = useRouter();
  const tracking = useTracking();
  const [sport, setSport] = useState<(typeof SPORTS)[number]>('run');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { status, session, points, stats, elapsedMs, warning } = tracking;
  const isIdle = status === 'idle';
  const isLive = status === 'recording' || status === 'paused' || status === 'acquiring';
  const hasTrack = points.length > 1;

  const geoPoints = useMemo(() => toGeoPoints(points), [points]);
  const sportColor = theme.sport[sport];

  const onStop = useCallback(async () => {
    await tracking.stop();
  }, [tracking]);

  const onSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const activityId = await saveActivity({
        title: title.trim() || `${SPORT_LABELS[sport]} ${new Date().toLocaleDateString()}`,
        sportType: sport,
        points,
      });
      await tracking.discard();
      setTitle('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/activity/${activityId}`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save the activity.');
    } finally {
      setSaving(false);
    }
  }, [router, saving, sport, title, points, tracking]);

  const onDiscard = useCallback(() => {
    Alert.alert('Discard this activity?', 'The recorded track will be deleted. This cannot be undone.', [
      { text: 'Keep recording', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          void tracking.discard();
          setTitle('');
        },
      },
    ]);
  }, [tracking]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {isLive ? (
          <>
            <View style={styles.liveHeader}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>
                {status === 'paused' ? 'PAUSED' : status === 'acquiring' ? 'GETTING GPS…' : 'RECORDING'}
              </Text>
              {session != null && !session.backgroundAllowed && (
                <Pressable onPress={() => void tracking.requestBackground()} accessibilityRole="button">
                  <Text style={styles.enableBg}>Enable background</Text>
                </Pressable>
              )}
            </View>

            <Text style={styles.clock} accessibilityLiveRegion="polite">
              {formatStopwatch(elapsedMs / 1000)}
            </Text>

            {hasTrack ? (
              <TrackMap points={geoPoints} color={sportColor} showCurrentMarker height={280} />
            ) : (
              <View style={styles.mapPlaceholder}>
                <Text style={styles.placeholderText}>Waiting for your first GPS fix…</Text>
              </View>
            )}

            {warning != null && (
              <View style={styles.warning}>
                <Text style={styles.warningText}>{warning.message}</Text>
              </View>
            )}

            {stats != null && (
              <StatGrid
                stats={[
                  { label: 'Distance', value: formatDistance(stats.distanceM) },
                  { label: 'Moving', value: formatDuration(stats.movingTimeS) },
                  {
                    label: sport === 'ride' ? 'Speed' : 'Pace',
                    value:
                      sport === 'ride'
                        ? formatSpeed(stats.avgMovingSpeedMps)
                        : formatPace(stats.distanceM, stats.movingTimeS),
                  },
                  { label: 'Elev gain', value: `${Math.round(stats.elevationGainM)} m` },
                ]}
              />
            )}

            <Text style={styles.pointCount}>
              {points.length} points recorded
              {tracking.rejectedPoints > 0 ? ` · ${tracking.rejectedPoints} rejected as inaccurate` : ''}
            </Text>

            {status === 'recording' ? (
              <PrimaryButton title="Pause" onPress={() => void tracking.pause()} variant="secondary" />
            ) : (
              <PrimaryButton title="Resume" onPress={() => void tracking.resume()} variant="secondary" />
            )}
            <PrimaryButton title="Finish" onPress={() => void onStop()} disabled={!hasTrack} />
          </>
        ) : isIdle ? (
          <>
            <Text style={styles.title}>Record an activity</Text>
            <Text style={styles.subtitle}>
              Your route is stored on this device while you record, then uploaded when you finish.
            </Text>

            <Text style={styles.label}>Activity type</Text>
            <View style={styles.sportRow}>
              {SPORTS.map((s) => {
                const selected = s === sport;
                return (
                  <Pressable
                    key={s}
                    onPress={() => setSport(s)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={[
                      styles.sportChip,
                      selected && { backgroundColor: theme.sport[s], borderColor: theme.sport[s] },
                    ]}
                  >
                    <Text style={[styles.sportChipText, selected && styles.sportChipTextSelected]}>
                      {SPORT_LABELS[s]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {warning != null && (
              <View style={styles.warning}>
                <Text style={styles.warningText}>{warning.message}</Text>
              </View>
            )}

            <PrimaryButton
              title="Start recording"
              onPress={() => void tracking.start(sport)}
            />
          </>
        ) : (
          <>
            <Text style={styles.title}>Review your activity</Text>
            <Text style={styles.subtitle}>Give it a name, then save it to your profile.</Text>

            {hasTrack ? (
              <TrackMap points={geoPoints} color={sportColor} height={240} />
            ) : (
              <EmptyState
                title="Not enough GPS data"
                body="At least two recorded points are needed to save an activity. Try recording somewhere with a clearer sky view."
              />
            )}

            {stats != null && (
              <StatGrid
                stats={[
                  { label: 'Distance', value: formatDistance(stats.distanceM) },
                  { label: 'Moving', value: formatDuration(stats.movingTimeS) },
                  { label: 'Elapsed', value: formatStopwatch(stats.elapsedTimeS) },
                  {
                    label: sport === 'ride' ? 'Avg speed' : 'Avg pace',
                    value:
                      sport === 'ride'
                        ? formatSpeed(stats.avgMovingSpeedMps)
                        : formatPace(stats.distanceM, stats.movingTimeS),
                  },
                  { label: 'Max speed', value: formatSpeed(stats.maxSpeedMps) },
                  { label: 'Elev gain', value: `${Math.round(stats.elevationGainM)} m` },
                ]}
              />
            )}

            <Text style={styles.label}>Title</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder={`${SPORT_LABELS[sport]} ${new Date().toLocaleDateString()}`}
              placeholderTextColor={theme.colors.muted}
              accessibilityLabel="Activity title"
              maxLength={200}
            />

            {saveError != null && <ErrorState message={saveError} onRetry={() => void onSave()} />}

            <PrimaryButton
              title={saving ? 'Saving…' : 'Save activity'}
              onPress={() => void onSave()}
              disabled={!hasTrack || saving}
              loading={saving}
            />
            <PrimaryButton title="Discard" onPress={onDiscard} variant="danger" disabled={saving} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surface },
  container: { padding: theme.space.lg, gap: theme.space.md, paddingBottom: theme.space.xxl },
  title: { fontSize: 24, fontWeight: '800', color: theme.colors.ink },
  subtitle: { fontSize: 14, color: theme.colors.inkSoft, lineHeight: 20 },
  liveHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.danger },
  liveText: { fontSize: 13, fontWeight: '800', color: theme.colors.danger, letterSpacing: 1, flex: 1 },
  enableBg: { fontSize: 13, fontWeight: '700', color: theme.colors.orange, paddingVertical: 8 },
  clock: {
    fontSize: 44,
    fontWeight: '300',
    color: theme.colors.ink,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    paddingVertical: theme.space.sm,
  },
  mapPlaceholder: {
    height: 280,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: { color: theme.colors.muted, fontSize: 14 },
  warning: {
    backgroundColor: '#FFF4E5',
    borderRadius: theme.radius.sm,
    padding: theme.space.md,
  },
  warningText: { color: '#8A5A00', fontSize: 13, lineHeight: 18 },
  pointCount: { fontSize: 12, color: theme.colors.muted, textAlign: 'center' },
  label: { fontSize: 13, fontWeight: '600', color: theme.colors.inkSoft, marginTop: theme.space.sm },
  sportRow: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm },
  sportChip: {
    paddingHorizontal: theme.space.lg,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.surfaceAlt,
    minHeight: 44,
    justifyContent: 'center',
  },
  sportChipText: { color: theme.colors.inkSoft, fontWeight: '600', fontSize: 14 },
  sportChipTextSelected: { color: theme.colors.white },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: 14,
    fontSize: 16,
    color: theme.colors.ink,
    backgroundColor: theme.colors.surfaceAlt,
    minHeight: 48,
  },
});
