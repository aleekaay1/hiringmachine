/**
 * Appends to candidates.admin_data.emailsSent after automated (Edge) sends so admin UI shows a full log.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const DEFAULT_ADMIN = {
  notes: [] as unknown[],
  pipelineStage: 'Check in',
  rating: null as number | null,
  interviewScheduledAt: null as string | null,
  nextStep: '',
  tags: [] as string[],
  emailsSent: [] as Array<{ sentAt: string; subject: string; type?: string }>,
  resumeReviewedAt: null as string | null,
  questionnaireDisqualified: null as unknown,
};

export async function appendCandidateEmailLog(
  supabase: SupabaseClient,
  candidateId: string,
  entry: { sentAt: string; subject: string; type: string }
): Promise<void> {
  const { data: row, error: selErr } = await supabase
    .from('candidates')
    .select('admin_data')
    .eq('id', candidateId)
    .maybeSingle();

  if (selErr) {
    console.error('appendCandidateEmailLog: select failed', selErr);
    return;
  }
  if (!row) {
    console.error('appendCandidateEmailLog: candidate missing', candidateId);
    return;
  }

  const prev =
    row.admin_data && typeof row.admin_data === 'object' && row.admin_data !== null
      ? (row.admin_data as Record<string, unknown>)
      : {};
  const prevEmails = Array.isArray(prev.emailsSent) ? prev.emailsSent : [];
  const merged = {
    ...DEFAULT_ADMIN,
    ...prev,
    emailsSent: [...prevEmails, entry],
  };

  const { error: upErr } = await supabase.from('candidates').update({ admin_data: merged }).eq('id', candidateId);
  if (upErr) {
    console.error('appendCandidateEmailLog: update failed', upErr);
  }
}
