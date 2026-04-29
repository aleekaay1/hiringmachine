/**
 * Internal email when a candidate completes the Leadership & Career Assessment.
 * Set secret ASSESSMENT_COMPLETE_NOTIFY_EMAIL in Supabase (Dashboard → Edge Functions → Secrets).
 * Comma- or semicolon-separated addresses. Same SMTP/from as candidate emails (talent acquisition).
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Row shape from candidates table (subset). */
export type AssessmentNotifyCandidateRow = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  city: string | null;
  timestamp: string | null;
  status: string | null;
  fit_category: string | null;
  score: number | null;
  applicant_questionnaire?: Record<string, unknown> | null;
  assessment?: Record<string, unknown> | null;
};

export function parseAssessmentNotifyRecipients(): string[] {
  const raw = Deno.env.get('ASSESSMENT_COMPLETE_NOTIFY_EMAIL')?.trim() ?? '';
  if (!raw) return ['leaders@globelife-paz.com'];
  return raw
    .split(/[,;]/)
    .map((a) => a.trim())
    .filter(Boolean);
}

export function buildAssessmentInternalNotificationSubject(candidateName: string): string {
  const name = candidateName.trim() || 'Candidate';
  return `Leadership Assessment completed — ${name}`;
}

export function buildAssessmentInternalNotificationHtml(row: AssessmentNotifyCandidateRow): string {
  const name =
    `${(row.first_name || '').trim()} ${(row.last_name || '').trim()}`.trim() || '—';
  const fmt = (v: string | null | undefined) => escapeHtml((v ?? '').toString() || '—');
  const fmtNum = (v: number | null | undefined) =>
    v != null && !Number.isNaN(Number(v)) ? escapeHtml(String(v)) : '—';
  let submitted = '—';
  if (row.timestamp) {
    try {
      submitted = escapeHtml(new Date(row.timestamp).toLocaleString('en-CA', { timeZone: 'America/Toronto' }));
    } catch {
      submitted = fmt(row.timestamp);
    }
  }
  const aq = (row.applicant_questionnaire && typeof row.applicant_questionnaire === 'object')
    ? row.applicant_questionnaire as Record<string, unknown>
    : {};
  const assessment = (row.assessment && typeof row.assessment === 'object')
    ? row.assessment as Record<string, unknown>
    : {};
  const backgroundAreas = Array.isArray(aq.backgroundAreas)
    ? aq.backgroundAreas.map((x) => String(x)).join(', ')
    : '—';

  return `
<p>A candidate has completed the <strong>Leadership &amp; Career Assessment</strong>. Use the details below for follow-up.</p>
<table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#ccc;font-family:Arial,sans-serif;font-size:14px;">
  <tr><td><strong>Candidate ID</strong></td><td>${fmt(row.id)}</td></tr>
  <tr><td><strong>Name</strong></td><td>${fmt(name)}</td></tr>
  <tr><td><strong>Email</strong></td><td>${fmt(row.email)}</td></tr>
  <tr><td><strong>Phone</strong></td><td>${fmt(row.phone)}</td></tr>
  <tr><td><strong>City</strong></td><td>${fmt(row.city)}</td></tr>
  <tr><td><strong>Record status</strong></td><td>${fmt(row.status)}</td></tr>
  <tr><td><strong>Fit category</strong></td><td>${fmt(row.fit_category)}</td></tr>
  <tr><td><strong>Assessment score</strong></td><td>${fmtNum(row.score)}</td></tr>
  <tr><td><strong>Occupation</strong></td><td>${fmt(aq.occupation as string | undefined)}</td></tr>
  <tr><td><strong>Current role</strong></td><td>${fmt(aq.currentRole as string | undefined)}</td></tr>
  <tr><td><strong>Background areas</strong></td><td>${fmt(backgroundAreas)}</td></tr>
  <tr><td><strong>Sales experience</strong></td><td>${fmt(aq.salesExperience as string | undefined)}</td></tr>
  <tr><td><strong>Competitiveness (1-10)</strong></td><td>${fmtNum(Number(assessment.competitiveness ?? NaN))}</td></tr>
  <tr><td><strong>Money motivation (1-10)</strong></td><td>${fmtNum(Number(assessment.moneyMotivation ?? NaN))}</td></tr>
  <tr><td><strong>Submitted</strong></td><td>${submitted}</td></tr>
</table>
<p style="font-size:12px;color:#666;">This is an automated internal notification from the hiring portal.</p>
  `.trim();
}

type MailTransport = {
  sendMail: (mailOptions: object, callback: (err: Error | null) => void) => void;
};

export async function sendAssessmentInternalNotificationIfConfigured(
  transport: MailTransport,
  from: string,
  row: AssessmentNotifyCandidateRow
): Promise<{ sent: boolean; recipients: number }> {
  const recipients = parseAssessmentNotifyRecipients();
  if (recipients.length === 0) {
    return { sent: false, recipients: 0 };
  }

  const candidateName =
    `${(row.first_name || '').trim()} ${(row.last_name || '').trim()}`.trim() || 'Candidate';
  const subject = buildAssessmentInternalNotificationSubject(candidateName);
  const html = buildAssessmentInternalNotificationHtml(row);
  const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  await new Promise<void>((resolve, reject) => {
    transport.sendMail(
      {
        from,
        to: recipients.join(', '),
        subject,
        text,
        html,
      },
      (err: Error | null) => (err ? reject(err) : resolve())
    );
  });

  return { sent: true, recipients: recipients.length };
}
