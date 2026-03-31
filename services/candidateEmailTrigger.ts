/**
 * Triggers Supabase Edge Function send-candidate-email (no admin JWT).
 * Called after successful check-in submit (eligible candidates).
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export async function triggerPostCheckinEmail(candidateId: string, candidateEmail: string): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('Check-in email: missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
    return;
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-candidate-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        candidateId,
        candidateEmail: candidateEmail.trim().toLowerCase(),
        trigger: 'post_checkin',
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      console.warn('Check-in automated email failed:', res.status, j);
    }
  } catch (e) {
    console.error('Check-in email trigger error', e);
  }
}
