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

/**
 * A profile is only meaningful for the user it was loaded for. Storing the
 * owning userId alongside it lets the value be derived at render time instead of
 * reset inside an effect: calling setState synchronously in an effect causes a
 * second render pass, and a sign-out followed by a sign-in as someone else could
 * otherwise show the previous user's profile for a frame.
 */
interface LoadedProfile {
  userId: string;
  profile: Profile | null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState<LoadedProfile | null>(null);
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
    if (!userId) return;

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
      setLoaded({ userId, profile: parsed.success ? parsed.data : null });
    };

    void load(0);

    return () => {
      active = false;
    };
  }, [userId]);

  // Derived rather than stored: null unless the loaded profile belongs to the
  // current user. Sign-out and user-switch fall out of this for free.
  const profile = loaded != null && loaded.userId === userId ? loaded.profile : null;

  const value = useMemo<AuthState>(
    () => ({
      session,
      user,
      profile,
      loading,
      signOut: async () => {
        await supabase.auth.signOut();
        setLoaded(null);
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
