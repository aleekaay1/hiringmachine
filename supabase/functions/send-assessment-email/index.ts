// Stage 4: "We received your Leadership Assessment" — called from the app after assessment submit (anon + service-role verify).
// Deploy separately if send-candidate-email is an older bundle: supabase functions deploy send-assessment-email
// Secrets: same SMTP as send-email + SUPABASE_SERVICE_ROLE_KEY

import nodemailer from 'npm:nodemailer@6.9.10';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { jsPDF } from 'npm:jspdf@2.5.1';
import {
  applyPostAssessmentSubmitMerge,
  POST_ASSESSMENT_SUBMIT_EMAIL_SUBJECT,
} from '../_shared/postAssessmentSubmitEmailTemplate.ts';
import { buildEmailSignatureHtml } from '../_shared/emailSignatureHtml.ts';
import {
  buildAssessmentInternalNotificationHtml,
  type AssessmentNotifyCandidateRow,
} from '../_shared/assessmentCompleteInternalNotification.ts';
import { appendCandidateEmailLog } from '../_shared/candidateEmailLog.ts';
import { insertEmailSendLog } from '../_shared/emailSendLog.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

function getTransport() {
  const host = Deno.env.get('SMTP_HOSTNAME')?.trim();
  const port = Number(Deno.env.get('SMTP_PORT') ?? 587);
  const secure = (Deno.env.get('SMTP_SECURE') ?? 'false') === 'true';
  const user = Deno.env.get('SMTP_USERNAME')?.trim();
  const pass = Deno.env.get('SMTP_PASSWORD')?.trim();
  if (!host || !user || !pass) {
    throw new Error('Missing SMTP config (SMTP_HOSTNAME, SMTP_USERNAME, SMTP_PASSWORD)');
  }
  return nodemailer.createTransport({
    host,
    port: Number.isNaN(port) ? 587 : port,
    secure,
    auth: { user, pass },
    ...(port === 587 && !secure ? { requireTLS: true } : {}),
  });
}

async function downloadPublicFileAsAttachment(url: string): Promise<{ filename: string; content: string; encoding: 'base64'; contentType?: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const ab = await res.arrayBuffer();
    const bytes = new Uint8Array(ab);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);
    const parts = url.split('/');
    const filename = (parts[parts.length - 1] || 'resume').split('?')[0] || 'resume';
    return { filename, content: base64, encoding: 'base64', contentType };
  } catch {
    return null;
  }
}

function safeText(v: unknown): string {
  const s = String(v ?? '').trim();
  return s || 'N/A';
}

function toYesNoMaybe(v: unknown): string {
  if (v === 'yes') return 'Yes';
  if (v === 'no') return 'No';
  if (v === 'maybe') return 'Maybe';
  return safeText(v);
}

function getAssessmentSummaryLines(assessmentRaw: Record<string, unknown> | null | undefined, score: unknown, fitCategory: unknown): string[] {
  const assessment = (assessmentRaw && typeof assessmentRaw === 'object') ? assessmentRaw : {};
  const competitiveness = Number(assessment.competitiveness ?? NaN);
  const moneyMotivation = Number(assessment.moneyMotivation ?? NaN);
  const compBand = Number.isFinite(competitiveness) ? (competitiveness >= 7 ? 'high' : competitiveness >= 4 ? 'moderate' : 'low') : 'unknown';
  const moneyBand = Number.isFinite(moneyMotivation) ? (moneyMotivation >= 7 ? 'high' : moneyMotivation >= 4 ? 'moderate' : 'low') : 'unknown';
  return [
    `Assessment score: ${safeText(score)} (${safeText(fitCategory)}).`,
    `Competitiveness: ${Number.isFinite(competitiveness) ? competitiveness : 'N/A'} (${compBand}).`,
    `Money motivation: ${Number.isFinite(moneyMotivation) ? moneyMotivation : 'N/A'} (${moneyBand}).`,
    'Candidate completed leadership assessment successfully.',
  ];
}

function buildCandidateProfilePdfBase64(row: Record<string, unknown>): { base64: string; filename: string } {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 42;
  const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;
  let y = margin;
  const addLine = (text: string, size = 11, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, maxWidth);
    if (y + lines.length * (size + 3) > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(lines, margin, y);
    y += lines.length * (size + 3) + 6;
  };

  const aq = (row.applicant_questionnaire && typeof row.applicant_questionnaire === 'object')
    ? row.applicant_questionnaire as Record<string, unknown>
    : {};
  const assessment = (row.assessment && typeof row.assessment === 'object')
    ? row.assessment as Record<string, unknown>
    : {};
  const summary = getAssessmentSummaryLines(assessment, row.score, row.fit_category);

  addLine('Candidate Report', 18, true);
  addLine(`Generated: ${new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })}`, 10);
  addLine('');
  addLine('1) Candidate information', 13, true);
  addLine(`Name: ${safeText(row.first_name)} ${safeText(row.last_name)}`);
  addLine(`Email: ${safeText(row.email)}`);
  addLine(`Phone: ${safeText(row.phone)}`);
  addLine(`City: ${safeText(row.city)}`);
  addLine(`Status: ${safeText(row.status)}`);
  addLine('');
  addLine('2) Applicant questionnaire', 13, true);
  addLine(`Occupation: ${safeText(aq.occupation)}`);
  addLine(`Current role: ${safeText(aq.currentRole)}`);
  addLine(`Background areas: ${Array.isArray(aq.backgroundAreas) ? aq.backgroundAreas.map((x) => String(x)).join(', ') : 'N/A'}`);
  addLine(`Sales experience: ${safeText(aq.salesExperience)}`);
  const resumeUrlsPdf = Array.isArray(aq.resumeUrls)
    ? aq.resumeUrls.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  if (resumeUrlsPdf.length) {
    addLine(`Resume file URLs: ${resumeUrlsPdf.join('; ')}`);
  } else {
    addLine('Resume file URLs: N/A');
  }
  addLine(`LinkedIn profile: ${safeText(typeof aq.linkedinProfileUrl === 'string' ? aq.linkedinProfileUrl : '')}`);
  addLine(`What stood out: ${safeText(aq.whatStoodOut)}`);
  addLine(`Why good fit: ${safeText(aq.whyGoodFit)}`);
  addLine(`Position interest: ${safeText(aq.positionInterest)}`);
  addLine(`Contact permission: ${toYesNoMaybe(aq.contactPermission)}`);
  addLine(`Background check willing: ${toYesNoMaybe(aq.backgroundCheckWilling)}`);
  addLine('');
  addLine('3) Assessment summary', 13, true);
  summary.forEach((s) => addLine(`- ${s}`));

  const dataUri = doc.output('datauristring');
  const base64 = dataUri.includes(',') ? dataUri.split(',')[1]! : dataUri;
  const nameSafe = `${safeText(row.first_name)}_${safeText(row.last_name)}`.replace(/[^a-z0-9_-]+/gi, '_');
  return { base64, filename: `${nameSafe}_candidate_profile.pdf` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!serviceRole) {
      return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const candidateId =
      body?.candidateId != null && body.candidateId !== '' ? String(body.candidateId).trim() : '';
    const candidateEmail =
      typeof body?.candidateEmail === 'string' ? body.candidateEmail.trim().toLowerCase() : '';

    if (!candidateId) {
      return new Response(JSON.stringify({ error: 'Invalid request', detail: 'missing_candidate_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!candidateEmail) {
      return new Response(JSON.stringify({ error: 'Invalid request', detail: 'missing_candidate_email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRole);
    const { data: row, error: qErr } = await admin
      .from('candidates')
      .select('id, email, first_name, last_name, phone, city, timestamp, status, fit_category, score, applicant_questionnaire, assessment')
      .eq('id', candidateId)
      .maybeSingle();

    if (qErr || !row) {
      return new Response(JSON.stringify({ error: 'Candidate not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const dbEmail = (row.email as string).trim().toLowerCase();
    if (dbEmail !== candidateEmail) {
      return new Response(JSON.stringify({ error: 'Email mismatch' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const firstName = ((row.first_name as string) || '').trim();
    const lastName = ((row.last_name as string) || '').trim();
    const candidateName = `${firstName} ${lastName}`.trim() || 'Candidate';
    const sig = buildEmailSignatureHtml();
    const subject = POST_ASSESSMENT_SUBMIT_EMAIL_SUBJECT;
    const html = applyPostAssessmentSubmitMerge(candidateName, sig);

    const from =
      Deno.env.get('SMTP_FROM')?.trim() ||
      Deno.env.get('SMTP_USERNAME')?.trim() ||
      'noreply@example.com';
    const transport = getTransport();
    await new Promise<void>((resolve, reject) => {
      transport.sendMail(
        {
          from,
          to: candidateEmail,
          subject,
          text: html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
          html,
        },
        (err: Error | null) => (err ? reject(err) : resolve())
      );
    });

    await appendCandidateEmailLog(admin, candidateId, {
      sentAt: new Date().toISOString(),
      subject,
      type: 'automated_post_assessment_submit',
    });

    await insertEmailSendLog(admin, {
      source: 'send-assessment-email',
      trigger_label: 'assessment_received_candidate',
      from_email: from,
      to_email: candidateEmail,
      subject,
      candidate_id: candidateId,
      status: 'sent',
      metadata: { path: 'stage4_candidate' },
    });

    const notifyRow = row as AssessmentNotifyCandidateRow;
    try {
      const aq = (notifyRow.applicant_questionnaire && typeof notifyRow.applicant_questionnaire === 'object')
        ? notifyRow.applicant_questionnaire as Record<string, unknown>
        : {};
      const resumeUrls = Array.isArray(aq.resumeUrls)
        ? aq.resumeUrls.map((x) => String(x || '').trim()).filter(Boolean)
        : [];
      const linkedinUrl =
        typeof aq.linkedinProfileUrl === 'string' ? aq.linkedinProfileUrl.trim() : '';
      const attachments: Array<{ filename: string; content: string; encoding: 'base64'; contentType?: string }> = [];
      for (const resumeUrl of resumeUrls.slice(0, 3)) {
        const att = await downloadPublicFileAsAttachment(resumeUrl);
        if (att) attachments.push(att);
      }
      const summaryHtml = `
<p><strong>Assessment summary</strong></p>
<ul>
  <li>Score: ${notifyRow.score ?? '—'}</li>
  <li>Fit category: ${notifyRow.fit_category ?? '—'}</li>
  <li>Status: ${notifyRow.status ?? '—'}</li>
</ul>
${resumeUrls.length > 0 ? `<p><strong>Resume links</strong>: ${resumeUrls.map((u) => `<a href="${u}">${u}</a>`).join('<br/>')}</p>` : '<p><strong>Resume links</strong>: —</p>'}
${linkedinUrl ? `<p><strong>LinkedIn</strong>: <a href="${linkedinUrl}">${linkedinUrl}</a></p>` : '<p><strong>LinkedIn</strong>: —</p>'}
      `.trim();
      const internalHtml = `${buildAssessmentInternalNotificationHtml(notifyRow)}<br/>${summaryHtml}<br/>${buildEmailSignatureHtml()}`;
      const internalRecipients = (Deno.env.get('ASSESSMENT_COMPLETE_NOTIFY_EMAIL')?.trim() || 'leaders@globelife-paz.com');
      const profilePdf = buildCandidateProfilePdfBase64(row as Record<string, unknown>);
      const internalSubject = `Leadership Assessment submitted — ${candidateName}`;
      await new Promise<void>((resolve, reject) => {
        transport.sendMail(
          {
            from,
            to: internalRecipients,
            subject: internalSubject,
            text: internalHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
            html: internalHtml,
            attachments: [
              {
                filename: profilePdf.filename,
                content: profilePdf.base64,
                encoding: 'base64',
                contentType: 'application/pdf',
              },
              ...attachments,
            ],
          },
          (err: Error | null) => (err ? reject(err) : resolve())
        );
      });
      await insertEmailSendLog(admin, {
        source: 'send-assessment-email',
        trigger_label: 'assessment_received_internal_leaders',
        from_email: from,
        to_email: internalRecipients,
        subject: internalSubject,
        candidate_id: candidateId,
        status: 'sent',
        metadata: { path: 'internal_with_pdf', resumeAttachmentCount: attachments.length },
      });
    } catch (notifyErr) {
      console.error('send-assessment-email: internal notification failed:', notifyErr);
      try {
        const internalRecipients = (Deno.env.get('ASSESSMENT_COMPLETE_NOTIFY_EMAIL')?.trim() || 'leaders@globelife-paz.com');
        const internalSubject = `Leadership Assessment submitted — ${candidateName}`;
        await insertEmailSendLog(admin, {
          source: 'send-assessment-email',
          trigger_label: 'assessment_received_internal_leaders',
          from_email: from,
          to_email: internalRecipients,
          subject: internalSubject,
          candidate_id: candidateId,
          status: 'failed',
          error_message: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
          metadata: { path: 'internal_with_pdf' },
        });
      } catch {
        /* ignore */
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('send-assessment-email error:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Failed to send email' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
