import { Stack } from 'expo-router';
import { theme } from '../../src/theme/tokens';

export default function ActivityLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.ink,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
      }}
    />
  );
}
