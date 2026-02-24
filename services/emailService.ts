const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;

export interface SendEmailParams {
  to: string;
  subject: string;
  bodyHtml?: string;
  bodyText?: string;
}

/** Send email via Edge Function. Requires auth token. */
export async function sendEmail(
  accessToken: string,
  params: SendEmailParams
): Promise<{ ok: true } | { error: string }> {
  if (!SUPABASE_URL) {
    return { error: 'App is not configured for email (missing VITE_SUPABASE_URL).' };
  }
  const url = `${SUPABASE_URL}/functions/v1/send-email`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: params.to.trim(),
      subject: params.subject.trim(),
      bodyHtml: params.bodyHtml || undefined,
      bodyText: params.bodyText || undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { error: (data?.error as string) || res.statusText || 'Failed to send email' };
  }
  return { ok: true };
}
