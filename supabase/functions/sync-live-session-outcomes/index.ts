/**
 * Match Booked (Live Session) dispositions to Calendly/Zoom registrants; persist outcome on call records.
 * Deploy: supabase functions deploy sync-live-session-outcomes
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  matchLiveSessionForCallDisposition,
  type LiveSessionRegistrantRow,
} from '../_shared/liveSessionBookedOutcomes.ts';
import { syncAllEligibleRecruiterCoins } from '../_shared/recruiterCoins.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

type CallRecordRow = {
  id: string;
  candidate_id: string;
  recruiter_user_id: string | null;
  disposition: string;
  booked_subtype: string | null;
  dialed_number: string;
  disposed_at: string;
  created_at: string;
  threecx_metadata: Record<string, unknown> | null;
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function readBookedSubtype(record: CallRecordRow): string {
  const meta = record.threecx_metadata && typeof record.threecx_metadata === 'object'
    ? record.threecx_metadata
    : {};
  return String(record.booked_subtype || meta.booked_subtype || meta.bookedSubtype || '').trim().toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json(401, { error: 'Unauthorized' });

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (!supabaseUrl || !anonKey || !serviceRole) return json(500, { error: 'Server misconfiguration' });

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: auth, error: authErr } = await authClient.auth.getUser();
    if (authErr || !auth.user) return json(401, { error: 'Invalid session' });

    const { data: profile } = await authClient
      .from('user_profiles')
      .select('role, email')
      .eq('user_id', auth.user.id)
      .maybeSingle();
    const role = String(profile?.role || '');
    const email = String(profile?.email || '').trim().toLowerCase();
    const allowed = role === 'admin' || role === 'leadership'
      || email === 'ali@globelife-paz.com' || email === 'hr.licensing@globelife-paz.com';
    if (!allowed) return json(403, { error: 'Forbidden' });

    const body = (await req.json().catch(() => ({}))) as { syncCoins?: boolean; daysBack?: number };
    const daysBack = Number(body.daysBack) > 0 ? Math.min(Number(body.daysBack), 120) : 90;
    const sinceIso = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const admin = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [{ data: registrants, error: regErr }, { data: records, error: recErr }] = await Promise.all([
      admin.from('live_session_registrants').select('session_date, email, phone, attended_zoom, calendly_no_show, zoom_join_at'),
      admin.from('pipeline_call_records')
        .select('id, candidate_id, recruiter_user_id, disposition, booked_subtype, dialed_number, disposed_at, created_at, threecx_metadata')
        .gte('disposed_at', sinceIso)
        .ilike('disposition', 'booked')
        .order('disposed_at', { ascending: false })
        .limit(5000),
    ]);
    if (regErr) throw regErr;
    if (recErr) throw recErr;

    const liveRows = (registrants || []) as LiveSessionRegistrantRow[];
    const bookedLive = (records || []).filter((r) => readBookedSubtype(r as CallRecordRow) === 'live session') as CallRecordRow[];
    const candidateIds = [...new Set(bookedLive.map((r) => r.candidate_id).filter(Boolean))];

    const emailById = new Map<string, string>();
    const phoneById = new Map<string, string>();
    const chunk = 150;
    for (let i = 0; i < candidateIds.length; i += chunk) {
      const slice = candidateIds.slice(i, i + chunk);
      const { data: candidates } = await admin
        .from('pipeline_candidates')
        .select('id, email, phone')
        .in('id', slice);
      for (const c of candidates || []) {
        const id = String(c.id || '');
        const em = String(c.email || '').trim().toLowerCase();
        const ph = String(c.phone || '').trim();
        if (id && em) emailById.set(id, em);
        if (id && ph) phoneById.set(id, ph);
      }
    }

    let scanned = 0;
    let matched = 0;
    let attended = 0;
    let scheduled = 0;
    let updated = 0;

    for (const record of bookedLive) {
      scanned += 1;
      const disposedMs = Date.parse(record.disposed_at || record.created_at);
      const outcome = matchLiveSessionForCallDisposition({
        email: emailById.get(record.candidate_id) || null,
        candidatePhone: phoneById.get(record.candidate_id) || null,
        dialedNumber: record.dialed_number,
        disposedAtMs: Number.isFinite(disposedMs) ? disposedMs : Date.now(),
        registrants: liveRows,
      });

      if (outcome.status === 'pending') continue;
      matched += 1;
      if (outcome.status === 'attended') attended += 1;
      if (outcome.status === 'scheduled') scheduled += 1;

      const existingMeta = record.threecx_metadata && typeof record.threecx_metadata === 'object'
        ? record.threecx_metadata
        : {};

      const patch = {
        threecx_metadata: {
          ...existingMeta,
          live_session_outcome: outcome.status,
          live_session_date: outcome.sessionDate,
          live_session_match_method: outcome.matchMethod,
          live_session_matched_at: new Date().toISOString(),
          live_session_attended_zoom: outcome.status === 'attended',
        },
      };

      const { error: upErr } = await admin.from('pipeline_call_records').update(patch).eq('id', record.id);
      if (!upErr) updated += 1;
    }

    let coinsSynced = 0;
    if (body.syncCoins !== false) {
      const coinResult = await syncAllEligibleRecruiterCoins(admin);
      coinsSynced = coinResult.usersSynced || 0;
    }

    return json(200, {
      ok: true,
      scanned,
      matched,
      attended,
      scheduled,
      updated,
      registrantRows: liveRows.length,
      coinsSynced,
      message: updated > 0
        ? `Matched ${updated} live session booking(s) (${attended} attended, ${scheduled} scheduled).`
        : scanned > 0
          ? 'No Calendly/Zoom matches yet — refresh Live Sessions first, then try again.'
          : 'No Booked (Live Session) dispositions in range.',
    });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : 'Sync failed' });
  }
});
