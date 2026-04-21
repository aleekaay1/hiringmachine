/**
 * Applies Calendly invite + Zoom attendance from the live-sessions dashboard to portal candidates:
 * tag "Career session invited", pipeline "Attended Live Session" when Zoom shows attendance,
 * and one automated Stage 3 assessment email per candidate (deduped via admin_data.emailsSent).
 * Auth: Supabase JWT (same pattern as integrations-zoom-calendly).
 * Deploy: supabase functions deploy sync-live-session-pipeline
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  pipelineStageAfterAssessmentFormSent,
  pipelineStageAfterLiveSessionAttended,
  pipelineStageAfterLiveSessionInvited,
} from '../_shared/pipelineStageLiveSession.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const STAGE3_LOG_TYPE = 'automated_stage3_after_live_session';
const LEGACY_INVITE_TAG = 'Career session invited';

const DEFAULT_ADMIN = {
  notes: [] as unknown[],
  pipelineStage: 'Checked In',
  rating: null as number | null,
  interviewScheduledAt: null as string | null,
  nextStep: '',
  tags: [] as string[],
  emailsSent: [] as Array<{ sentAt: string; subject: string; type?: string }>,
  evaluation: null as {
    doneAt: string;
    evaluatorName: string;
    comments: string;
    evaluationEmailSentAt?: string;
  } | null,
  resumeReviewedAt: null as string | null,
  questionnaireDisqualified: null as unknown,
};

function normEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function parseAdmin(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && raw !== null ? { ...(raw as Record<string, unknown>) } : {};
}

function mergeAdminBase(prev: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...DEFAULT_ADMIN, ...prev };
  if (Array.isArray(merged.tags)) {
    merged.tags = merged.tags.filter((t) => String(t).trim().toLowerCase() !== LEGACY_INVITE_TAG.toLowerCase());
  }
  return merged;
}

async function fetchCandidatesByEmails(
  admin: ReturnType<typeof createClient>,
  emails: string[]
): Promise<Map<string, { id: string; email: string; admin_data: unknown }>> {
  const map = new Map<string, { id: string; email: string; admin_data: unknown }>();
  const chunk = 200;
  for (let i = 0; i < emails.length; i += chunk) {
    const slice = emails.slice(i, i + chunk);
    if (slice.length === 0) continue;
    const { data, error } = await admin.from('candidates').select('id, email, admin_data').in('email', slice);
    if (error) throw new Error(`candidates query: ${error.message}`);
    for (const row of data ?? []) {
      const em = normEmail((row as { email?: string }).email);
      if (em) map.set(em, row as { id: string; email: string; admin_data: unknown });
    }
  }
  return map;
}

async function sendStage3AssessmentEmail(
  supabaseUrl: string,
  anonKey: string,
  candidateId: string,
  candidateEmail: string
): Promise<boolean> {
  const res = await fetch(`${supabaseUrl}/functions/v1/send-candidate-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      candidateId,
      candidateEmail,
      trigger: 'post_live_session_assessment',
    }),
  });
  return res.ok;
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
    const authHeader = req.headers.get('Authorization');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!serviceRole) {
      return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const apikeyHeader = req.headers.get('apikey')?.trim() ?? '';
    const allowAnonAppRequest = apikeyHeader === anonKey;

    if (!allowAnonAppRequest) {
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
        error: authErr,
      } = await userClient.auth.getUser();
      if (authErr || !user) {
        return new Response(
          JSON.stringify({
            error: 'Invalid or expired session',
            detail: authErr?.message ?? 'no_user',
          }),
          {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const invitedEmails = [...new Set(asStringArray(body.invitedEmails).map(normEmail).filter((e) => e.length > 0))];
    const attendedEmails = [...new Set(asStringArray(body.attendedEmails).map(normEmail).filter((e) => e.length > 0))];

    const admin = createClient(supabaseUrl, serviceRole);
    const union = [...new Set([...invitedEmails, ...attendedEmails])];
    const byEmail = await fetchCandidatesByEmails(admin, union);

    let invitedStageUpdated = 0;
    let skippedInviteNoRow = 0;
    let attendedUpdated = 0;
    let assessmentStageUpdated = 0;
    let attendedSkippedNoRow = 0;
    let assessmentEmailsSent = 0;
    let assessmentEmailFailed = 0;

    for (const email of invitedEmails) {
      const row = byEmail.get(email);
      if (!row) {
        skippedInviteNoRow++;
        continue;
      }
      const prev = parseAdmin(row.admin_data);
      const merged = mergeAdminBase(prev);
      const nextStage = pipelineStageAfterLiveSessionInvited(merged.pipelineStage);
      if (String(nextStage) === String(merged.pipelineStage)) continue;
      merged.pipelineStage = nextStage;
      const { error: upErr } = await admin.from('candidates').update({ admin_data: merged }).eq('id', row.id);
      if (upErr) {
        console.error('sync-live-session-pipeline invite tag', upErr);
        continue;
      }
      invitedStageUpdated++;
      byEmail.set(email, { ...row, admin_data: merged });
    }

    for (const email of attendedEmails) {
      const row = byEmail.get(email);
      if (!row) {
        attendedSkippedNoRow++;
        continue;
      }
      const prev = parseAdmin(row.admin_data);
      const merged = mergeAdminBase(prev);
      const beforeStage = merged.pipelineStage;
      const newStage = pipelineStageAfterLiveSessionAttended(beforeStage);
      merged.pipelineStage = newStage;

      const emailsSent = Array.isArray(merged.emailsSent) ? merged.emailsSent : [];
      const alreadyStage3 = emailsSent.some(
        (e: { type?: string }) => e && typeof e === 'object' && e.type === STAGE3_LOG_TYPE
      );

      const { error: upErr } = await admin.from('candidates').update({ admin_data: merged }).eq('id', row.id);
      if (upErr) {
        console.error('sync-live-session-pipeline attended', upErr);
        continue;
      }
      attendedUpdated++;
      byEmail.set(email, { ...row, admin_data: merged });

      const shouldSend =
        !alreadyStage3 &&
        newStage === 'Live Career Overview Session Attended' &&
        typeof anonKey === 'string' &&
        anonKey.length > 0;

      if (shouldSend) {
        const ok = await sendStage3AssessmentEmail(supabaseUrl, anonKey, row.id, email);
        if (ok) {
          assessmentEmailsSent++;
          const promote = {
            ...merged,
            pipelineStage: pipelineStageAfterAssessmentFormSent(merged.pipelineStage),
          };
          const { error: promoteErr } = await admin.from('candidates').update({ admin_data: promote }).eq('id', row.id);
          if (!promoteErr) {
            assessmentStageUpdated++;
            byEmail.set(email, { ...row, admin_data: promote });
          } else {
            console.error('sync-live-session-pipeline assessment stage promote', promoteErr);
          }
        } else assessmentEmailFailed++;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        invited_stage_updated: invitedStageUpdated,
        skipped_invite_not_in_portal: skippedInviteNoRow,
        attended_rows_updated: attendedUpdated,
        assessment_stage_updated: assessmentStageUpdated,
        skipped_attended_not_in_portal: attendedSkippedNoRow,
        assessment_emails_sent: assessmentEmailsSent,
        assessment_email_send_failed: assessmentEmailFailed,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('sync-live-session-pipeline:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Sync failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
