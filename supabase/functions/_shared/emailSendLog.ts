/**
 * Persists a row to public.email_send_logs (service-role client; RLS has no insert for users).
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type EmailSendLogRow = {
  source: string;
  trigger_label?: string | null;
  from_email: string;
  to_email: string;
  cc_email?: string | null;
  subject: string;
  candidate_id?: string | null;
  sent_by_user_id?: string | null;
  status: 'sent' | 'failed';
  error_message?: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function insertEmailSendLog(supabase: SupabaseClient, row: EmailSendLogRow): Promise<void> {
  const payload = {
    source: row.source,
    trigger_label: row.trigger_label ?? null,
    from_email: row.from_email,
    to_email: row.to_email,
    cc_email: row.cc_email?.trim() || null,
    subject: row.subject,
    candidate_id: row.candidate_id?.trim() || null,
    sent_by_user_id: row.sent_by_user_id?.trim() || null,
    status: row.status,
    error_message: row.error_message ?? null,
    metadata: row.metadata ?? null,
  };
  let { error } = await supabase.from('email_send_logs').insert(payload);
  if (error && payload.candidate_id) {
    const fallback = {
      ...payload,
      candidate_id: null,
      metadata: {
        ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
        pipeline_candidate_id: payload.candidate_id,
      },
    };
    const retry = await supabase.from('email_send_logs').insert(fallback);
    error = retry.error;
  }
  if (error) {
    console.error('insertEmailSendLog failed:', error.message, payload);
  }
}
