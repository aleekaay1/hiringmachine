/**
 * Resolves leadership assessment access by portal candidate email/phone OR live session
 * (Calendly registrants + Zoom participant lists). Creates a portal candidate when needed.
 * Deploy: supabase functions deploy assessment-lookup
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

const DEFAULT_ADMIN = {
  notes: [] as unknown[],
  pipelineStage: 'Checked In',
  rating: null as number | null,
  interviewScheduledAt: null as string | null,
  nextStep: '',
  tags: [] as string[],
  emailsSent: [] as unknown[],
  evaluation: null,
  resumeReviewedAt: null as string | null,
  questionnaireDisqualified: null as unknown,
};

const DEFAULT_QUESTIONNAIRE = {
  occupation: '',
  currentRole: '',
  backgroundAreas: [] as string[],
  salesExperience: '',
  somethingAboutYourself: '',
  legallyEntitledCanada: 'yes' as const,
  resumeUrls: [] as string[],
};

type LiveSessionMatch = {
  email: string;
  name: string;
  phone: string;
  attendedZoom: boolean;
  sessionDate: string;
  source: 'live_session_calendly' | 'live_session_zoom';
};

function normEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function phoneDigits(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '');
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function newCandidateId(): string {
  return crypto.randomUUID().split('-')[0]!.toUpperCase();
}

function hasCompletedAssessment(row: Record<string, unknown>): boolean {
  const status = String(row.status || '').trim().toLowerCase();
  if (status === 'assessment_complete') return true;
  const assessment = row.assessment;
  return assessment != null && typeof assessment === 'object';
}

function candidateResponse(row: Record<string, unknown>, source: string) {
  return {
    ok: true,
    candidateId: String(row.id),
    source,
    alreadyCompleted: hasCompletedAssessment(row),
    displayName: `${String(row.first_name || '').trim()} ${String(row.last_name || '').trim()}`.trim(),
  };
}

async function findCandidateByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<Record<string, unknown> | null> {
  if (!email) return null;
  const { data, error } = await admin
    .from('candidates')
    .select('id, email, first_name, last_name, phone, city, timestamp, status, assessment, admin_data, applicant_questionnaire')
    .ilike('email', email)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`candidates email: ${error.message}`);
  return data as Record<string, unknown> | null;
}

async function findCandidateByPhone(
  admin: ReturnType<typeof createClient>,
  digits: string,
): Promise<Record<string, unknown> | null> {
  if (digits.length < 7) return null;
  const tail = digits.slice(-10);
  const { data, error } = await admin
    .from('candidates')
    .select('id, email, first_name, last_name, phone, city, timestamp, status, assessment, admin_data, applicant_questionnaire')
    .ilike('phone', `%${tail}%`)
    .order('timestamp', { ascending: false })
    .limit(5);
  if (error) throw new Error(`candidates phone: ${error.message}`);
  for (const row of data ?? []) {
    const rowDigits = phoneDigits((row as { phone?: string }).phone);
    if (rowDigits === digits || rowDigits.endsWith(tail) || digits.endsWith(rowDigits.slice(-10))) {
      return row as Record<string, unknown>;
    }
  }
  return null;
}

async function findLiveSessionRegistrantMatch(
  admin: ReturnType<typeof createClient>,
  email: string,
  phoneDigitsInput: string,
): Promise<LiveSessionMatch | null> {
  if (email) {
    const { data, error } = await admin
      .from('live_session_registrants')
      .select('email, name, phone, attended_zoom, session_date')
      .ilike('email', email)
      .order('session_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`live_session_registrants: ${error.message}`);
    if (data) {
      return {
        email: normEmail(data.email),
        name: String(data.name || '').trim(),
        phone: String(data.phone || '').trim(),
        attendedZoom: Boolean(data.attended_zoom),
        sessionDate: String(data.session_date || ''),
        source: 'live_session_calendly',
      };
    }
  }

  if (phoneDigitsInput.length >= 7) {
    const tail = phoneDigitsInput.slice(-10);
    const { data, error } = await admin
      .from('live_session_registrants')
      .select('email, name, phone, attended_zoom, session_date')
      .ilike('phone', `%${tail}%`)
      .order('session_date', { ascending: false })
      .limit(10);
    if (error) throw new Error(`live_session_registrants phone: ${error.message}`);
    for (const row of data ?? []) {
      const rowDigits = phoneDigits(row.phone);
      if (!rowDigits) continue;
      if (rowDigits === phoneDigitsInput || rowDigits.endsWith(tail) || phoneDigitsInput.endsWith(rowDigits.slice(-10))) {
        const em = normEmail(row.email);
        if (!em) continue;
        return {
          email: em,
          name: String(row.name || '').trim(),
          phone: String(row.phone || '').trim(),
          attendedZoom: Boolean(row.attended_zoom),
          sessionDate: String(row.session_date || ''),
          source: 'live_session_calendly',
        };
      }
    }
  }

  return null;
}

function matchEmailInSnapshotPayload(
  payload: Record<string, unknown>,
  email: string,
): LiveSessionMatch | null {
  const past = Array.isArray(payload.past_meetings) ? payload.past_meetings : [];
  for (const meeting of past) {
    if (!meeting || typeof meeting !== 'object') continue;
    const m = meeting as Record<string, unknown>;
    const sessionDate = String(
      (m.calendly as { start_time?: string } | undefined)?.start_time ||
        (m.zoom as { start_time?: string } | undefined)?.start_time ||
        '',
    ).slice(0, 10);

    const invitees = Array.isArray(m.invitees) ? m.invitees : [];
    for (const inv of invitees) {
      if (!inv || typeof inv !== 'object') continue;
      const o = inv as Record<string, unknown>;
      if (normEmail(o.email) !== email) continue;
      return {
        email,
        name: String(o.name || '').trim(),
        phone: String(o.phone_number || o.phone || '').trim(),
        attendedZoom: Boolean(o.attended_zoom),
        sessionDate,
        source: 'live_session_calendly',
      };
    }

    const participants = Array.isArray(m.participants) ? m.participants : [];
    for (const p of participants) {
      if (!p || typeof p !== 'object') continue;
      const o = p as Record<string, unknown>;
      const pEmail = normEmail(o.email ?? o.user_email);
      if (pEmail !== email) continue;
      return {
        email: pEmail,
        name: String(o.name || '').trim(),
        phone: '',
        attendedZoom: true,
        sessionDate,
        source: 'live_session_zoom',
      };
    }

    const walkins = Array.isArray(m.walkin_emails) ? m.walkin_emails : [];
    for (const w of walkins) {
      if (normEmail(w) === email) {
        return {
          email,
          name: String(w).includes('@') ? '' : String(w).trim(),
          phone: '',
          attendedZoom: true,
          sessionDate,
          source: 'live_session_zoom',
        };
      }
    }
  }
  return null;
}

async function findLiveSessionSnapshotMatch(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<LiveSessionMatch | null> {
  if (!email) return null;
  const { data, error } = await admin
    .from('live_sessions_snapshots')
    .select('payload')
    .order('generated_at', { ascending: false })
    .limit(3);
  if (error) throw new Error(`live_sessions_snapshots: ${error.message}`);
  for (const row of data ?? []) {
    const payload = (row as { payload?: unknown }).payload;
    if (!payload || typeof payload !== 'object') continue;
    const hit = matchEmailInSnapshotPayload(payload as Record<string, unknown>, email);
    if (hit) return hit;
  }
  return null;
}

async function createCandidateFromLiveSession(
  admin: ReturnType<typeof createClient>,
  match: LiveSessionMatch,
): Promise<Record<string, unknown>> {
  const existing = await findCandidateByEmail(admin, match.email);
  if (existing) return existing;

  const { firstName, lastName } = splitName(match.name);
  const pipelineStage = match.attendedZoom
    ? pipelineStageAfterLiveSessionAttended('Checked In')
    : pipelineStageAfterLiveSessionInvited('Checked In');

  const row = {
    id: newCandidateId(),
    first_name: firstName || match.email.split('@')[0] || 'Candidate',
    last_name: lastName,
    email: match.email,
    phone: phoneDigits(match.phone),
    city: '',
    timestamp: new Date().toISOString(),
    status: 'new',
    admin_data: {
      ...DEFAULT_ADMIN,
      pipelineStage,
      liveSessionAssessmentLookup: {
        at: new Date().toISOString(),
        sessionDate: match.sessionDate || null,
        source: match.source,
      },
    },
    applicant_questionnaire: { ...DEFAULT_QUESTIONNAIRE },
    assessment: null,
    score: null,
    fit_category: null,
  };

  const { data, error } = await admin.from('candidates').insert(row).select('*').single();
  if (error) throw new Error(`create candidate: ${error.message}`);
  return data as Record<string, unknown>;
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

    const body = await req.json().catch(() => ({}));
    const email = normEmail(body?.email);
    const phone = phoneDigits(body?.phone);

    if (!email && phone.length < 7) {
      return new Response(
        JSON.stringify({ ok: false, error: 'missing_contact', message: 'Enter your email or phone number.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const admin = createClient(supabaseUrl, serviceRole);

    if (email) {
      const byEmail = await findCandidateByEmail(admin, email);
      if (byEmail) {
        return new Response(JSON.stringify(candidateResponse(byEmail, 'portal')), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (phone.length >= 7) {
      const byPhone = await findCandidateByPhone(admin, phone);
      if (byPhone) {
        return new Response(JSON.stringify(candidateResponse(byPhone, 'portal_phone')), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    let liveMatch = await findLiveSessionRegistrantMatch(admin, email, phone);
    if (!liveMatch && email) {
      liveMatch = await findLiveSessionSnapshotMatch(admin, email);
    }

    if (!liveMatch) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'not_found',
          message:
            'We could not find your email on our live session list or in the portal. Please confirm the email you used on Calendly or Zoom, or contact the management team.',
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const created = await createCandidateFromLiveSession(admin, liveMatch);
    return new Response(
      JSON.stringify(candidateResponse(created, liveMatch.source)),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('assessment-lookup:', e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'Lookup failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
