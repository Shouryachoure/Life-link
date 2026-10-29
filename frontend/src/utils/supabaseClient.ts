import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;
let initError: string | null = null;

function sanitizeSupabaseUrl(url: string | undefined): string {
  if (!url) return '';
  // Strip trailing REST endpoints if erroneously provided
  return url.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '').trim();
}

export function initSupabase(): SupabaseClient | null {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const rawUrl = import.meta.env.VITE_SUPABASE_URL;
  const rawKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const url = sanitizeSupabaseUrl(rawUrl);
  const key = (rawKey || '').trim();

  if (!url || !key) {
    initError = 'Supabase environment configuration is incomplete. Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY.';
    return null;
  }

  try {
    supabaseInstance = createClient(url, key, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storageKey: 'lifelink_supabase_auth',
      },
    });
    initError = null;
    return supabaseInstance;
  } catch (err: any) {
    initError = `Failed to initialize Supabase client: ${err?.message || 'Unknown error'}`;
    return null;
  }
}

export const supabase = initSupabase();

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseInstance !== null);
}

export function getSupabaseInitError(): string | null {
  return initError;
}

