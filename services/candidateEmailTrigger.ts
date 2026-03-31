/**
 * Triggers Supabase Edge Function send-candidate-email (no admin JWT).
 * post_checkin: after check-in submit. post_assessment_submit: after Leadership Assessment submit.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

type CandidateEmailTrigger = 'post_checkin' | 'post_assessment_submit';

async function triggerSendCandidateEmail(
  candidateId: string,
  candidateEmail: string,
  trigger: CandidateEmailTrigger
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('Candidate email: missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
    return;
  }
  const id = String(candidateId ?? '').trim();
  const email = String(candidateEmail ?? '')
    .trim()
    .toLowerCase();
  if (!id || !email) {
    console.warn('Candidate email: missing candidate id or email', { trigger, id: id || '(empty)' });
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
        candidateId: id,
        candidateEmail: email,
        trigger,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      console.warn('Automated candidate email failed:', trigger, res.status, j);
    }
  } catch (e) {
    console.error('Candidate email trigger error', trigger, e);
  }
}

export async function triggerPostCheckinEmail(candidateId: string, candidateEmail: string): Promise<void> {
  return triggerSendCandidateEmail(candidateId, candidateEmail, 'post_checkin');
}

export async function triggerPostAssessmentSubmitEmail(candidateId: string, candidateEmail: string): Promise<void> {
  return triggerSendCandidateEmail(candidateId, candidateEmail, 'post_assessment_submit');
}
