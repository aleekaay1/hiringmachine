import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase environment variables are not set. Please configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  );
}

/**
 * Auth-js expects `lock` with signature (name, acquireTimeout, fn) => Promise<R>.
 * A previous custom lock used the wrong shape (treating arg2 as a callback), which broke
 * client init and made every page look logged out. This implementation simply runs `fn()`
 * without the Navigator LockManager (avoids multi-tab lock timeouts; fine for typical CRM use).
 */
const authInlineLock = async <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> =>
  fn();

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    lock: authInlineLock,
  },
});

