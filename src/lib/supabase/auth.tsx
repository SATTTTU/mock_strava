import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './client';
import { profileSchema, type Profile } from '../validation/schemas';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const user = session?.user ?? null;
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      return;
    }

    let active = true;

    // The auth trigger creates the row, so a brief 404 on first login is
    // expected. Retry rather than leaving the profile permanently null.
    const load = async (attempt: number) => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, bio, weight_kg, created_at')
        .eq('id', userId)
        .maybeSingle();

      if (!active) return;

      if (error) {
        if (attempt < 4) {
          setTimeout(() => void load(attempt + 1), 500 * attempt);
          return;
        }
        console.warn('[auth] failed to load profile', error.message);
        return;
      }

      if (!data && attempt < 4) {
        setTimeout(() => void load(attempt + 1), 500 * attempt);
        return;
      }

      const parsed = profileSchema.safeParse(data);
      setProfile(parsed.success ? parsed.data : null);
    };

    void load(0);

    return () => {
      active = false;
    };
  }, [userId]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user,
      profile,
      loading,
      signOut: async () => {
        await supabase.auth.signOut();
        setProfile(null);
      },
    }),
    [session, user, profile, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
