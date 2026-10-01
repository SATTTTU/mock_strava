import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, RefreshControl, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCurrentUserId, useUserActivities } from '../../src/lib/supabase/queries';
import { theme } from '../../src/theme/tokens';
import { SportBadge, EmptyState, ErrorState } from '../../src/components/common';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { SPORT_LABELS, formatDate, formatDistance, formatDuration } from '../../src/lib/format';

const FILTERS = ['all', 'run', 'ride', 'hike', 'walk'] as const;
type Filter = (typeof FILTERS)[number];

export default function ActivitiesScreen() {
  const router = useRouter();
  const userId = useCurrentUserId();
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const activities = useUserActivities(userId ?? '');

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await activities.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [activities]);

  const all = activities.data ?? [];
  const items = filter === 'all' ? all : all.filter((a) => a.sport_type === filter);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Activities</Text>
        <Text style={styles.headerSubtitle}>
          {all.length} {all.length === 1 ? 'activity' : 'activities'} recorded
        </Text>
      </View>

      <View style={styles.filters}>
        {FILTERS.map((f) => {
          const selected = f === filter;
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={[styles.filterChip, selected && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, selected && styles.filterTextActive]}>
                {f === 'all' ? 'All' : SPORT_LABELS[f]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activities.isPending ? (
        <View style={styles.center}>
          <Text style={styles.muted}>Loading…</Text>
        </View>
      ) : activities.isError ? (
        <ErrorState message={activities.error.message} onRetry={() => void activities.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={items.length === 0 ? styles.emptyWrap : styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.orange} />
          }
          ListEmptyComponent={
            <EmptyState
              title={all.length === 0 ? 'No activities recorded' : 'Nothing in this category'}
              body={
                all.length === 0
                  ? 'Head to the Record tab and log your first activity. It only takes a minute.'
                  : 'Try a different filter, or record a new activity.'
              }
              actionLabel={all.length === 0 ? 'Record an activity' : undefined}
              onAction={all.length === 0 ? () => router.push('/(tabs)/record') : undefined}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/activity/${item.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${formatDistance(item.distance_m)}`}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.rowLeft}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.rowMeta}>
                  {formatDate(item.started_at)} · {formatDistance(item.distance_m)} ·{' '}
                  {formatDuration(item.moving_time_s)}
                </Text>
              </View>
              <SportBadge sport={item.sport_type} size="sm" />
            </Pressable>
          )}
        />
      )}

      {all.length > 0 && (
        <View style={styles.footer}>
          <PrimaryButton
            title="Record another activity"
            onPress={() => router.push('/(tabs)/record')}
            variant="secondary"
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surfaceAlt },
  header: {
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
  },
  headerTitle: { fontSize: 24, fontWeight: '800', color: theme.colors.ink },
  headerSubtitle: { fontSize: 13, color: theme.colors.muted, marginTop: 2 },
  filters: {
    flexDirection: 'row',
    gap: theme.space.sm,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.md,
  },
  filterChip: {
    paddingHorizontal: theme.space.md,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.line,
    minHeight: 36,
    justifyContent: 'center',
  },
  filterChipActive: { backgroundColor: theme.colors.orange, borderColor: theme.colors.orange },
  filterText: { fontSize: 13, fontWeight: '600', color: theme.colors.inkSoft },
  filterTextActive: { color: theme.colors.white },
  list: { paddingHorizontal: theme.space.lg, paddingBottom: theme.space.xl, gap: theme.space.sm },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: theme.colors.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    borderWidth: 1,
    borderColor: theme.colors.line,
    minHeight: 64,
  },
  rowPressed: { opacity: 0.9 },
  rowLeft: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.ink },
  rowMeta: { fontSize: 12, color: theme.colors.muted },
  footer: { padding: theme.space.lg },
});
