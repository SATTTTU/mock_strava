import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { theme } from '../theme/tokens';

export function StatGrid({
  stats,
  columns = 2,
}: {
  stats: { label: string; value: string }[];
  columns?: 2 | 3;
}) {
  return (
    <View style={[styles.grid, columns === 3 && styles.gridThree]}>
      {stats.map((s) => (
        <View key={s.label} style={[styles.cell, columns === 3 ? styles.cellThree : styles.cellTwo]}>
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {s.value}
          </Text>
          <Text style={styles.label}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function SportBadge({ sport, size = 'md' }: { sport: string; size?: 'sm' | 'md' }) {
  const color = theme.sport[sport as keyof typeof theme.sport] ?? theme.colors.muted;
  const icon = { run: '🏃', ride: '🚴', hike: '🥾', walk: '🚶' }[sport] ?? '•';

  return (
    <View style={[styles.badge, size === 'sm' && styles.badgeSm, { backgroundColor: `${color}1A` }]}>
      <Text style={{ fontSize: size === 'sm' ? 11 : 13 }}>{icon}</Text>
      <Text style={[styles.badgeText, { color }, size === 'sm' && styles.badgeTextSm]}>{sport.toUpperCase()}</Text>
    </View>
  );
}

export function VisibilityBadge({ visibility }: { visibility: string }) {
  const label = visibility === 'private' ? 'Private' : visibility === 'followers' ? 'Followers' : 'Public';
  return (
    <View style={styles.visibility}>
      <Text style={styles.visibilityText}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {actionLabel != null && onAction != null && (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          style={({ pressed }) => [styles.emptyAction, pressed && styles.emptyActionPressed]}
        >
          <Text style={styles.emptyActionText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.emptyBody}>{message}</Text>
      {onRetry != null && (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={({ pressed }) => [styles.emptyAction, pressed && styles.emptyActionPressed]}
        >
          <Text style={styles.emptyActionText}>Try again</Text>
        </Pressable>
      )}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  gridThree: { marginHorizontal: -theme.space.xs },
  cell: { paddingVertical: theme.space.md, paddingHorizontal: theme.space.xs },
  cellTwo: { width: '50%' },
  cellThree: { width: '33.33%' },
  value: { fontSize: 22, fontWeight: '800', color: theme.colors.ink },
  label: { fontSize: 12, color: theme.colors.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
  },
  badgeSm: { paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  badgeTextSm: { fontSize: 9 },
  visibility: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceAlt,
  },
  visibilityText: { fontSize: 11, color: theme.colors.inkSoft, fontWeight: '600' },
  empty: { alignItems: 'center', paddingVertical: theme.space.xxl, paddingHorizontal: theme.space.xl, gap: theme.space.sm },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: theme.colors.ink, textAlign: 'center' },
  emptyBody: { fontSize: 14, color: theme.colors.inkSoft, textAlign: 'center', lineHeight: 20 },
  errorTitle: { fontSize: 17, fontWeight: '700', color: theme.colors.danger, textAlign: 'center' },
  emptyAction: {
    marginTop: theme.space.sm,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: theme.space.lg,
  },
  emptyActionPressed: { opacity: 0.7 },
  emptyActionText: { color: theme.colors.orange, fontWeight: '700', fontSize: 15 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: theme.space.md,
  },
});
