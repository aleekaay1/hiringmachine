/**
 * Applies Calendly invite + Zoom attendance from the live-sessions dashboard to portal candidates:
 * tag "Career session invited", pipeline "Attended Live Session" when Zoom shows attendance.
 * Stage 3 assessment link email is MANUAL ONLY from admin and is not auto-sent here.
 * Auth: Supabase JWT (same pattern as integrations-zoom-calendly).
 * Deploy: supabase functions deploy sync-live-session-pipeline
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  pipelineStageAfterLiveSessionAttended,
  pipelineStageAfterLiveSessionInvited,
} from '../_shared/pipelineStageLiveSession.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

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
    let attendedSkippedNoRow = 0;

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

      const { error: upErr } = await admin.from('candidates').update({ admin_data: merged }).eq('id', row.id);
      if (upErr) {
        console.error('sync-live-session-pipeline attended', upErr);
        continue;
      }
      attendedUpdated++;
      byEmail.set(email, { ...row, admin_data: merged });

    }

    return new Response(
      JSON.stringify({
        ok: true,
        invited_stage_updated: invitedStageUpdated,
        skipped_invite_not_in_portal: skippedInviteNoRow,
        attended_rows_updated: attendedUpdated,
        skipped_attended_not_in_portal: attendedSkippedNoRow,
        assessment_stage_updated: 0,
        assessment_emails_sent: 0,
        assessment_email_send_failed: 0,
        note: 'Stage 3 assessment link email is manual-only; automation disabled.',
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
