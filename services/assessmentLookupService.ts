const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export type AssessmentLookupResult =
  | {
      ok: true;
      candidateId: string;
      source: string;
      alreadyCompleted: boolean;
      displayName?: string;
    }
  | { ok: false; error: string; message?: string };

export async function resolveAssessmentLookup(input: {
  email?: string;
  phone?: string;
}): Promise<AssessmentLookupResult> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing Supabase configuration.' };
  }

  const email = String(input.email ?? '').trim().toLowerCase();
  const phone = String(input.phone ?? '').trim();
  if (!email && !phone.replace(/\D/g, '')) {
    return { ok: false, error: 'Enter your email or phone number.' };
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/assessment-lookup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ email: email || undefined, phone: phone || undefined }),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      error: String(json.message || json.error || res.statusText || 'Lookup failed'),
      message: typeof json.message === 'string' ? json.message : undefined,
    };
  }

  const candidateId = String(json.candidateId || '').trim();
  if (!candidateId) {
    return { ok: false, error: 'Invalid lookup response.' };
  }

  return {
    ok: true,
    candidateId,
    source: String(json.source || 'portal'),
    alreadyCompleted: json.alreadyCompleted === true,
    displayName: typeof json.displayName === 'string' ? json.displayName : undefined,
  };
}
