import React from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../src/lib/supabase/auth';
import { useActivityStats, useCurrentUserId } from '../../src/lib/supabase/queries';
import { theme } from '../../src/theme/tokens';
import { StatGrid, Card, EmptyState } from '../../src/components/common';
import { PrimaryButton } from '../../src/components/PrimaryButton';
import { SPORT_LABELS, formatDistance, formatDuration, formatElevation } from '../../src/lib/format';

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, user, signOut } = useAuth();
  const userId = useCurrentUserId();
  const stats = useActivityStats(userId ?? '');

  const onSignOut = () => {
    Alert.alert('Sign out?', 'Your activities stay on your account.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(profile?.display_name ?? profile?.username ?? '?')[0]?.toUpperCase()}
            </Text>
          </View>
          <View style={styles.identity}>
            <Text style={styles.name} numberOfLines={1}>
              {profile?.display_name ?? 'Loading…'}
            </Text>
            {profile != null && <Text style={styles.username}>@{profile.username}</Text>}
            {user?.email != null && <Text style={styles.email} numberOfLines={1}>{user.email}</Text>}
          </View>
        </View>

        {profile?.bio != null && profile.bio.length > 0 && (
          <Text style={styles.bio}>{profile.bio}</Text>
        )}

        {stats.isPending ? (
          <Card>
            <Text style={styles.muted}>Loading your totals…</Text>
          </Card>
        ) : stats.isError ? (
          <EmptyState title="Could not load totals" body={stats.error.message} />
        ) : (stats.data?.count ?? 0) === 0 ? (
          <EmptyState
            title="No totals yet"
            body="Record an activity and your distance, time, and elevation totals will appear here."
            actionLabel="Record an activity"
            onAction={() => router.push('/(tabs)/record')}
          />
        ) : (
          <>
            <Card>
              <Text style={styles.cardTitle}>All time</Text>
              <StatGrid
                stats={[
                  { label: 'Activities', value: String(stats.data?.count ?? 0) },
                  { label: 'Distance', value: formatDistance(stats.data?.totalDistance ?? 0) },
                  { label: 'Moving time', value: formatDuration(stats.data?.totalMovingTime ?? 0) },
                  { label: 'Elev gain', value: formatElevation(stats.data?.totalElevation ?? 0) },
                ]}
              />
            </Card>

            {Object.entries(stats.data?.bySport ?? {})
              .sort((a, b) => b[1].distance - a[1].distance)
              .map(([sport, s]) => (
                <Card key={sport}>
                  <Text style={styles.cardTitle}>{SPORT_LABELS[sport] ?? sport}</Text>
                  <StatGrid
                    stats={[
                      { label: 'Activities', value: String(s.count) },
                      { label: 'Distance', value: formatDistance(s.distance) },
                    ]}
                  />
                </Card>
              ))}
          </>
        )}

        <PrimaryButton title="Sign out" onPress={onSignOut} variant="secondary" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.surfaceAlt },
  container: { padding: theme.space.lg, gap: theme.space.md, paddingBottom: theme.space.xxl },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: theme.colors.white, fontSize: 26, fontWeight: '800' },
  identity: { flex: 1, gap: 2 },
  name: { fontSize: 20, fontWeight: '800', color: theme.colors.ink },
  username: { fontSize: 14, color: theme.colors.orange, fontWeight: '600' },
  email: { fontSize: 12, color: theme.colors.muted },
  bio: { fontSize: 14, color: theme.colors.inkSoft, lineHeight: 20 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: theme.colors.inkSoft, marginBottom: theme.space.xs },
  muted: { color: theme.colors.muted, fontSize: 14 },
});
