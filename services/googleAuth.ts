import { supabase } from './supabaseClient';

export async function signInWithGoogle(redirectPath?: string): Promise<{ error: string | null }> {
  const redirectTo =
    typeof window !== 'undefined'
      ? `${window.location.origin}${redirectPath || window.location.pathname}`
      : undefined;

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: {
        prompt: 'select_account',
      },
    },
  });

  return { error: error?.message ?? null };
}
