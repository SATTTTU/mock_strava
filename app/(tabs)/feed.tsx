import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, RefreshControl, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { useFeed, useToggleKudos, type FeedItem } from '../../src/lib/supabase/queries';
import { useAuth } from '../../src/lib/supabase/auth';
import { theme } from '../../src/theme/tokens';
import { SportBadge, EmptyState, ErrorState } from '../../src/components/common';
import {
  SPORT_LABELS,
  formatDistance,
  formatDuration,
  formatRelativeTime,
  formatSpeed,
  formatPace,
} from '../../src/lib/format';

export default function FeedScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [refreshing, setRefreshing] = useState(false);
  const feed = useFeed();
  const toggleKudos = useToggleKudos();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await feed.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [feed]);

  const items = feed.data?.pages.flat() ?? [];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Feed</Text>
        {profile != null && <Text style={styles.headerSubtitle}>@{profile.username}</Text>}
      </View>

      {feed.isPending ? (
        <View style={styles.center}>
          <Text style={styles.muted}>Loading your feed…</Text>
        </View>
      ) : feed.isError ? (
        <ErrorState message={feed.error.message} onRetry={() => void feed.refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={items.length === 0 ? styles.emptyWrap : styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.orange} />}
          onEndReached={() => {
            if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <EmptyState
              title="No activity yet"
              body="Record your first run, ride, or hike and it will show up here. You can also see your own activities right away."
              actionLabel="Record an activity"
              onAction={() => router.push('/(tabs)/record')}
            />
          }
          ListFooterComponent={
            feed.isFetchingNextPage ? (
              <Text style={styles.footer}>Loading more…</Text>
            ) : items.length > 0 && !feed.hasNextPage ? (
              <Text style={styles.footer}>You have reached the end</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <FeedRow
              item={item}
              onPress={() => router.push(`/activity/${item.id}`)}
              onKudos={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                toggleKudos.mutate({ activityId: item.id, hasKudosed: item.has_kudosed });
              }}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function FeedRow({
  item,
  onPress,
  onKudos,
}: {
  item: FeedItem;
  onPress: () => void;
  onKudos: () => void;
}) {
  const isRide = item.sport_type === 'ride';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.title} by ${item.display_name}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(item.display_name || item.username)[0]?.toUpperCase() ?? '?'}</Text>
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.name} numberOfLines={1}>
            {item.display_name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {formatRelativeTime(item.created_at)} · {SPORT_LABELS[item.sport_type] ?? item.sport_type}
          </Text>
        </View>
        <SportBadge sport={item.sport_type} size="sm" />
      </View>

      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.title}
      </Text>

      <View style={styles.metrics}>
        <Metric label="Distance" value={formatDistance(item.distance_m)} />
        <Metric label="Moving" value={formatDuration(item.moving_time_s)} />
        <Metric
          label={isRide ? 'Speed' : 'Pace'}
          value={isRide ? formatSpeed(item.avg_speed_mps) : formatPace(item.distance_m, item.moving_time_s)}
        />
        <Metric label="Elev" value={`${Math.round(item.elevation_gain_m)} m`} />
      </View>

      <View style={styles.cardFooter}>
        <Pressable
          onPress={onKudos}
          accessibilityRole="button"
          accessibilityLabel={item.has_kudosed ? 'Remove kudos' : 'Give kudos'}
          accessibilityState={{ selected: item.has_kudosed }}
          hitSlop={8}
          style={styles.kudosButton}
        >
          <Text style={[styles.kudosText, item.has_kudosed && styles.kudosActive]}>
            {item.has_kudosed ? '★' : '☆'} {item.kudos_count}
          </Text>
        </Pressable>
        <Text style={styles.comments}>
          {item.comment_count} {item.comment_count === 1 ? 'comment' : 'comments'}
        </Text>
      </View>
    </Pressable>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
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
  list: { padding: theme.space.lg, gap: theme.space.md },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: theme.colors.muted },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.space.md,
    gap: theme.space.sm,
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
  cardPressed: { opacity: 0.9 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: theme.space.sm },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: theme.colors.white, fontWeight: '800', fontSize: 15 },
  cardHeaderText: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700', color: theme.colors.ink },
  meta: { fontSize: 12, color: theme.colors.muted, marginTop: 1 },
  cardTitle: { fontSize: 15, color: theme.colors.ink, fontWeight: '600' },
  metrics: { flexDirection: 'row', gap: theme.space.sm },
  metric: { flex: 1 },
  metricValue: { fontSize: 16, fontWeight: '800', color: theme.colors.ink },
  metricLabel: { fontSize: 10, color: theme.colors.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kudosButton: { minHeight: 44, justifyContent: 'center', paddingRight: theme.space.md },
  kudosText: { fontSize: 14, fontWeight: '700', color: theme.colors.inkSoft },
  kudosActive: { color: theme.colors.orange },
  comments: { fontSize: 12, color: theme.colors.muted },
  footer: { textAlign: 'center', color: theme.colors.muted, fontSize: 12, paddingVertical: theme.space.lg },
});
