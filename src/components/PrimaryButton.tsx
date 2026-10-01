import React from 'react';
import { Pressable, StyleSheet, Text, ActivityIndicator, type ViewStyle } from 'react-native';
import { theme } from '../theme/tokens';

interface Props {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  style?: ViewStyle;
  accessibilityHint?: string;
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
  variant = 'primary',
  style,
  accessibilityHint,
}: Props) {
  const isDisabled = disabled === true || loading === true;
  const tint = variant === 'secondary' ? theme.colors.orange : theme.colors.white;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading === true }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'danger' && styles.danger,
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tint} />
      ) : (
        <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space.lg,
  },
  primary: { backgroundColor: theme.colors.orange },
  secondary: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.orange },
  danger: { backgroundColor: theme.colors.danger },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  label: { fontSize: 16, fontWeight: '700' },
});
