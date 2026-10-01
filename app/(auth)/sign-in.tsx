import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, Pressable, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { supabase } from '../../src/lib/supabase/client';
import { theme } from '../../src/theme/tokens';
import { PrimaryButton } from '../../src/components/PrimaryButton';

const emailSchema = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const usernameSchema = /^[a-z0-9_]{3,30}$/;

export default function SignInScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const emailError = email.length > 0 && !emailSchema.test(email) ? 'Enter a valid email address' : null;
  const usernameError =
    mode === 'sign-up' && username.length > 0 && !usernameSchema.test(username)
      ? '3–30 characters: lowercase letters, numbers, underscore'
      : null;
  const passwordError = password.length > 0 && password.length < 8 ? 'At least 8 characters' : null;

  const canSubmit =
    emailSchema.test(email) && password.length >= 8 && (mode === 'sign-in' || usernameSchema.test(username));

  async function onSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      if (mode === 'sign-up') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { username: username.trim().toLowerCase() } },
        });
        if (signUpError) throw signUpError;
        if (!data.session) {
          setNotice('Check your inbox to confirm your email, then sign in.');
          setMode('sign-in');
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
      }
      void router.replace('/(tabs)/feed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.logo}>MockStrava</Text>
            <Text style={styles.tagline}>
              {mode === 'sign-in' ? 'Sign in to record your next activity' : 'Create an account to get started'}
            </Text>
          </View>

          {mode === 'sign-up' && (
            <Field
              label="Username"
              value={username}
              onChangeText={setUsername}
              placeholder="yourhandle"
              autoCapitalize="none"
              autoCorrect={false}
              error={usernameError}
            />
          )}

          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            error={emailError}
          />

          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            secureTextEntry
            autoCapitalize="none"
            error={passwordError}
          />

          {error != null && (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}
          {notice != null && <Text style={styles.notice}>{notice}</Text>}

          <PrimaryButton
            title={submitting ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
            onPress={onSubmit}
            disabled={!canSubmit || submitting}
            loading={submitting}
          />

          <Pressable
            onPress={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
              setError(null);
              setNotice(null);
            }}
            style={styles.switch}
            accessibilityRole="button"
          >
            <Text style={styles.switchText}>
              {mode === 'sign-in' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  error?: string | null;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'sentences';
  autoCorrect?: boolean;
}

function Field({ label, value, onChangeText, error, ...rest }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, error != null && styles.inputError]}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={theme.colors.muted}
        accessibilityLabel={label}
        {...rest}
      />
      {error != null && <Text style={styles.fieldError}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.orange },
  flex: { flex: 1 },
  container: {
    flexGrow: 1,
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: theme.space.xl,
    paddingTop: theme.space.xl,
    paddingBottom: theme.space.xl,
    gap: theme.space.md,
  },
  header: { marginBottom: theme.space.lg, gap: theme.space.xs },
  logo: { fontSize: 30, fontWeight: '900', color: theme.colors.orange, letterSpacing: -0.5 },
  tagline: { fontSize: 15, color: theme.colors.inkSoft },
  field: { gap: theme.space.xs },
  label: { fontSize: 13, fontWeight: '600', color: theme.colors.inkSoft },
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
  inputError: { borderColor: theme.colors.danger },
  fieldError: { fontSize: 12, color: theme.colors.danger },
  error: { fontSize: 14, color: theme.colors.danger, marginTop: theme.space.xs },
  notice: { fontSize: 14, color: theme.colors.success, marginTop: theme.space.xs },
  switch: { alignSelf: 'center', paddingVertical: theme.space.md, minHeight: 44, justifyContent: 'center' },
  switchText: { color: theme.colors.orange, fontWeight: '600', fontSize: 14 },
});
