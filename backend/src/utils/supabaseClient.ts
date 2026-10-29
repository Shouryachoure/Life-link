import { createClient, SupabaseClient } from '@supabase/supabase-js';

let serverClientInstance: SupabaseClient | null = null;

function sanitizeUrl(url: string | undefined): string {
  if (!url) return '';
  return url.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '').trim();
}

export function getSupabaseBackendClient(): SupabaseClient | null {
  if (serverClientInstance) {
    return serverClientInstance;
  }

  const rawUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const rawKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const url = sanitizeUrl(rawUrl);
  const key = (rawKey || '').trim();

  if (!url || !key) {
    return null;
  }

  try {
    serverClientInstance = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    return serverClientInstance;
  } catch (err) {
    console.error('[Supabase Backend] Initialization error:', err);
    return null;
  }
}

export function isSupabaseServerConfigured(): boolean {
  return getSupabaseBackendClient() !== null;
}

export async function verifySupabaseToken(token: string): Promise<{ user: any | null; error: string | null }> {
  const client = getSupabaseBackendClient();
  if (!client) {
    return { user: null, error: 'Supabase server configuration is missing.' };
  }

  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) {
      return { user: null, error: error?.message || 'Invalid Supabase access token.' };
    }
    return { user: data.user, error: null };
  } catch (err: any) {
    return { user: null, error: err?.message || 'Token verification exception.' };
  }
}

