import { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack, router, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AuthProvider, useAuth } from '../src/lib/supabase/auth';
import { TrackingProvider } from '../src/features/tracking/TrackingContext';
import { theme } from '../src/theme/tokens';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

function RootNavigator() {
  const { session, loading } = useAuth();
  const navState = useRootNavigationState();
  const ready = navState?.key != null;

  useEffect(() => {
    if (loading || !ready) return;

    const inAuth = navState.routes.some((r) => r.name === '(auth)');

    if (!session && !inAuth) {
      router.replace('/(auth)/sign-in');
    } else if (session && inAuth) {
      router.replace('/(tabs)/feed');
    }
  }, [session, loading, ready, navState.routes]);

  if (loading) {
    return (
      <View style={styles.splash}>
        <Text style={styles.logo}>MockStrava</Text>
        <ActivityIndicator color={theme.colors.white} style={styles.spinner} />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.surface },
      }}
    />
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TrackingProvider>
              <StatusBar style="light" />
              <RootNavigator />
            </TrackingProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.orange,
  },
  logo: { fontSize: 30, fontWeight: '900', color: theme.colors.white, letterSpacing: -0.5 },
  spinner: { marginTop: theme.space.lg },
});
