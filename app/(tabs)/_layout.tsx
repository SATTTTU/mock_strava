import React from 'react';
import { Platform, Pressable, Text, View, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs/types';
import * as Haptics from 'expo-haptics';

import { theme } from '../../src/theme/tokens';
import { useTracking } from '../../src/features/tracking/TrackingContext';

const LABELS: Record<string, string> = {
  feed: 'Feed',
  activities: 'My Activities',
  record: 'Record',
  profile: 'Profile',
};

function TabBar({ state, navigation }: BottomTabBarProps) {
  const { status } = useTracking();
  const isRecording = status === 'recording' || status === 'paused' || status === 'acquiring';

  return (
    <View style={styles.bar}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const isRecord = route.name === 'record';
        const tint = isRecord ? theme.colors.orange : focused ? theme.colors.orange : theme.colors.muted;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            void Haptics.selectionAsync();
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={LABELS[route.name] ?? route.name}
            style={styles.tab}
          >
            <View style={isRecord ? styles.recordButton : styles.iconSlot}>
              {isRecord ? (
                <View style={[styles.recordDot, isRecording && styles.recordDotLive]} />
              ) : (
                <TabIcon name={route.name} color={tint} />
              )}
            </View>
            <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
              {LABELS[route.name] ?? route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TabIcon({ name, color }: { name: string; color: string }) {
  const glyph = { feed: '≡', activities: '⛰', profile: '☺' }[name] ?? '•';
  return <Text style={{ fontSize: 20, color, lineHeight: 22 }}>{glyph}</Text>;
}

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="feed" options={{ title: 'Feed' }} />
      <Tabs.Screen name="activities" options={{ title: 'My Activities' }} />
      <Tabs.Screen name="record" options={{ title: 'Record' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.line,
    paddingTop: theme.space.sm,
    paddingBottom: Platform.OS === 'ios' ? theme.space.xl : theme.space.sm,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2, minHeight: 48, justifyContent: 'center' },
  iconSlot: { height: 28, justifyContent: 'center' },
  recordButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFF1EA',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -14,
    borderWidth: 2,
    borderColor: theme.colors.orange,
  },
  recordDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: theme.colors.orange },
  recordDotLive: { backgroundColor: theme.colors.danger },
  label: { fontSize: 11, fontWeight: '600' },
});
