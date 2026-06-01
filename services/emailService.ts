const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export interface EmailAttachmentPayload {
  filename: string;
  /** Raw base64 (no data: prefix). */
  contentBase64: string;
  contentType?: string;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  bodyHtml?: string;
  bodyText?: string;
  /** Comma-separated addresses, e.g. CC for staff. */
  cc?: string;
  attachments?: EmailAttachmentPayload[];
  /** Stored in email_send_logs.trigger_label for auditing. */
  trigger?: string;
  candidateId?: string;
  /** RFC5322 Message-ID this message is replying to (threading in Gmail / Outlook). */
  inReplyTo?: string;
  /** Space-separated list of prior Message-IDs in the thread. */
  references?: string;
  /** Attach .ics for the next (or selected) live session — resolved server-side. */
  attachLiveSessionCalendar?: boolean;
  /** YYYY-MM-DD session_date from live_session_occurrences (optional). */
  liveSessionDate?: string;
}

/** Send email via Edge Function. Requires auth token. */
export async function sendEmail(
  accessToken: string,
  params: SendEmailParams
): Promise<{ ok: true } | { error: string }> {
  if (!SUPABASE_URL) {
    return { error: 'App is not configured for email (missing VITE_SUPABASE_URL).' };
  }
  if (!SUPABASE_ANON_KEY) {
    return { error: 'App is not configured for email (missing VITE_SUPABASE_ANON_KEY).' };
  }
  const url = `${SUPABASE_URL}/functions/v1/send-email`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: params.to.trim(),
      subject: params.subject.trim(),
      bodyHtml: params.bodyHtml || undefined,
      bodyText: params.bodyText || undefined,
      cc: params.cc?.trim() || undefined,
      trigger: params.trigger?.trim() || undefined,
      candidateId: params.candidateId?.trim() || undefined,
      inReplyTo: params.inReplyTo?.trim() || undefined,
      references: params.references?.trim() || undefined,
      attachLiveSessionCalendar: params.attachLiveSessionCalendar === true ? true : undefined,
      liveSessionDate: params.liveSessionDate?.trim() || undefined,
      attachments:
        params.attachments?.map((a) => ({
          filename: a.filename,
          content: a.contentBase64,
          contentType: a.contentType || 'application/pdf',
        })) || undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { error: (data?.error as string) || res.statusText || 'Failed to send email' };
  }
  return { ok: true };
}
