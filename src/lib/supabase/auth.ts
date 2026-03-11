import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured, supabase } from '../supabase';

export async function getCurrentSession() {
  if (!isSupabaseConfigured || !supabase) {
    return null;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }

  return data.session;
}

export async function requireUserId() {
  const session = await getCurrentSession();
  const userId = session?.user.id;
  if (!userId) {
    throw new Error('Sessione Supabase non disponibile. Effettua il login.');
  }
  return userId;
}

export async function signInWithPassword(email: string, password: string) {
  const client = getSupabaseClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    throw error;
  }
}

export async function signUpWithPassword(email: string, password: string) {
  const client = getSupabaseClient();
  const { error } = await client.auth.signUp({ email, password });
  if (error) {
    throw error;
  }
}

export async function signOut() {
  if (!supabase) {
    return;
  }
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw error;
  }
}

export function subscribeToAuthChanges(callback: (session: Session | null) => void) {
  if (!supabase) {
    return () => undefined;
  }

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });

  return () => {
    data.subscription.unsubscribe();
  };
}
