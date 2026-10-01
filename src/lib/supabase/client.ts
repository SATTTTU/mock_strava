import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * The anon key is designed to ship in the client — it is gated by RLS, not by
 * secrecy. The service-role key must never appear in this bundle; if you find
 * one referenced here, that is a critical leak.
 */
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[supabase] EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY are not set. ' +
      'Copy .env.example to .env and fill in your project values.',
  );
}

/**
 * SecureStore has a 2048-byte value limit, which a refresh-token-heavy session
 * can exceed. AsyncStorage is the documented fallback in that case.
 */
const secureStorage = {
  getItem: async (key: string) => {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string) => {
    try {
      if (value.length > 2048) throw new Error('too large for keystore');
      await SecureStore.setItemAsync(key, value);
    } catch {
      // web has no SecureStore; this also covers the oversize fallback
      if (Platform.OS === 'web') {
        const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
        await AsyncStorage.setItem(key, value);
      }
    }
  },
  removeItem: async (key: string) => {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // ignore: nothing to remove
    }
  },
};

export const supabase: SupabaseClient = createClient(
  supabaseUrl ?? 'http://127.0.0.1:54321',
  supabaseAnonKey ?? 'missing-anon-key',
  {
    auth: {
      storage: secureStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
    global: {
      headers: { 'x-application-name': 'mock-strava' },
    },
    db: { schema: 'public' },
  },
);
