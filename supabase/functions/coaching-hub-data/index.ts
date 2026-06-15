/**
 * Coaching hub reads (performance check-ins, invites, email logs) with explicit CORS.
 * Deploy: supabase functions deploy coaching-hub-data
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const ADMIN_EMAILS = new Set([
  'ali@globelife-paz.com',
  'alex@globelife-paz.com',
  'reginald_bentajado@globelife-paz.com',
]);

function isMissingTableError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('does not exist') || m.includes('schema cache') || m.includes('relation');
}

async function loadViewerProfile(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ role: string; email: string } | null> {
  const { data } = await admin
    .from('user_profiles')
    .select('role, email')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  return {
    role: String((data as { role?: string }).role || ''),
    email: String((data as { email?: string }).email || '').trim().toLowerCase(),
  };
}

function isCoachingParticipant(profile: { role: string; email: string } | null): boolean {
  if (!profile) return false;
  return profile.role === 'recruiter' || profile.role === 'leadership' || profile.role === 'webinar' || profile.role === 'admin';
}

function isCoachingAdmin(profile: { role: string; email: string } | null): boolean {
  if (!profile) return false;
  if (profile.role === 'admin' || profile.role === 'leadership') return true;
  return ADMIN_EMAILS.has(profile.email);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
    if (!serviceRole) {
      return new Response(JSON.stringify({ error: 'Server misconfiguration' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await authClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRole);
    const viewer = await loadViewerProfile(admin, user.id);
    const coachingAdmin = isCoachingAdmin(viewer);

    const url = new URL(req.url);
    const action = (url.searchParams.get('action') || 'week').trim();

    if (action === 'week') {
      if (!coachingAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const weekSince = (url.searchParams.get('weekSince') || '').trim();
      let invitesQuery = admin
        .from('recruiter_performance_check_in_invites')
        .select('*')
        .order('created_at', { ascending: false });
      let formsQuery = admin
        .from('recruiter_performance_check_ins')
        .select('*')
        .order('submitted_at', { ascending: false });
      if (weekSince) {
        invitesQuery = invitesQuery.eq('week_since', weekSince);
        formsQuery = formsQuery.eq('week_since', weekSince);
      }

      const [invitesRes, formsRes] = await Promise.all([invitesQuery, formsQuery]);
      if (invitesRes.error && !isMissingTableError(invitesRes.error.message)) {
        return new Response(JSON.stringify({ error: invitesRes.error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (formsRes.error && !isMissingTableError(formsRes.error.message)) {
        return new Response(JSON.stringify({ error: formsRes.error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(
        JSON.stringify({
          ok: true,
          invites: invitesRes.error ? [] : invitesRes.data || [],
          forms: formsRes.error ? [] : formsRes.data || [],
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (action === 'ladder') {
      const userId = (url.searchParams.get('userId') || '').trim();
      if (!userId) {
        return new Response(JSON.stringify({ error: 'userId required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!coachingAdmin && userId !== user.id) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const limit = Math.min(24, Math.max(1, Number(url.searchParams.get('limit') || '10') || 10));
      const [formsRes, invitesRes] = await Promise.all([
        admin
          .from('recruiter_performance_check_ins')
          .select('*')
          .eq('user_id', userId)
          .order('week_since', { ascending: false })
          .limit(limit),
        admin
          .from('recruiter_performance_check_in_invites')
          .select(
            'week_since, week_until, calls_pace_pct, bookings_pace_pct, below_threshold, actual_calls, actual_booked',
          )
          .eq('user_id', userId)
          .order('week_since', { ascending: false })
          .limit(limit),
      ]);

      if (formsRes.error && !isMissingTableError(formsRes.error.message)) {
        return new Response(JSON.stringify({ error: formsRes.error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (invitesRes.error && !isMissingTableError(invitesRes.error.message)) {
        return new Response(JSON.stringify({ error: invitesRes.error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(
        JSON.stringify({
          ok: true,
          forms: formsRes.error ? [] : formsRes.data || [],
          invites: invitesRes.error ? [] : invitesRes.data || [],
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (action === 'participantForm') {
      if (!isCoachingParticipant(viewer)) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const token = (url.searchParams.get('token') || '').trim();
      const paramWeekSince = (url.searchParams.get('weekSince') || '').trim();
      const paramWeekUntil = (url.searchParams.get('weekUntil') || '').trim();

      let invite: Record<string, unknown> | null = null;
      if (token) {
        const { data, error } = await admin
          .from('recruiter_performance_check_in_invites')
          .select('*')
          .eq('invite_token', token)
          .maybeSingle();
        if (error && !isMissingTableError(error.message)) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (data) {
          if (String((data as { user_id?: string }).user_id || '') !== user.id) {
            return new Response(JSON.stringify({ error: 'This check-in link was sent to a different account.' }), {
              status: 403,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
          invite = data as Record<string, unknown>;
        }
      }

      const weekSince = String(invite?.week_since || paramWeekSince || '');
      const weekUntil = String(invite?.week_until || paramWeekUntil || '');
      if (!weekSince || !weekUntil) {
        return new Response(JSON.stringify({ error: 'weekSince and weekUntil required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const [existingRes, settingsRes] = await Promise.all([
        admin
          .from('recruiter_performance_check_ins')
          .select('id')
          .eq('user_id', user.id)
          .eq('week_since', weekSince)
          .maybeSingle(),
        admin
          .from('pipeline_user_call_settings')
          .select('daily_upload_target, daily_webinar_booking_target')
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);

      if (existingRes.error && !isMissingTableError(existingRes.error.message)) {
        return new Response(JSON.stringify({ error: existingRes.error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const settings = settingsRes.data as {
        daily_upload_target?: number | null;
        daily_webinar_booking_target?: number | null;
      } | null;

      let dailyCallTarget =
        typeof invite?.daily_call_target === 'number' ? invite.daily_call_target : settings?.daily_upload_target ?? null;
      let dailyBookingTarget =
        typeof invite?.daily_booking_target === 'number'
          ? invite.daily_booking_target
          : settings?.daily_webinar_booking_target ?? null;
      let elapsedDays = typeof invite?.elapsed_days === 'number' ? invite.elapsed_days : null;
      let actualCalls = typeof invite?.actual_calls === 'number' ? invite.actual_calls : null;
      let actualBooked = typeof invite?.actual_booked === 'number' ? invite.actual_booked : null;
      let expectedCalls = typeof invite?.expected_calls === 'number' ? invite.expected_calls : null;
      let expectedBookings = typeof invite?.expected_bookings === 'number' ? invite.expected_bookings : null;
      let callsPacePct = invite?.calls_pace_pct !== undefined && invite?.calls_pace_pct !== null
        ? Number(invite.calls_pace_pct)
        : null;
      let bookingsPacePct = invite?.bookings_pace_pct !== undefined && invite?.bookings_pace_pct !== null
        ? Number(invite.bookings_pace_pct)
        : null;

      if (actualCalls === null || actualBooked === null) {
        const weekStart = `${weekSince}T00:00:00.000-04:00`;
        const weekEnd = `${weekUntil}T23:59:59.999-04:00`;
        const { data: records, error: recordsErr } = await admin
          .from('pipeline_call_records')
          .select('disposition')
          .eq('recruiter_user_id', user.id)
          .gte('disposed_at', weekStart)
          .lte('disposed_at', weekEnd)
          .limit(3000);
        if (recordsErr && !/does not exist|schema cache|relation/i.test(recordsErr.message)) {
          const { data: logs } = await admin
            .from('pipeline_call_logs')
            .select('request_payload, response_payload, created_at')
            .eq('action', 'call_disposition_saved')
            .gte('created_at', weekStart)
            .lte('created_at', weekEnd)
            .limit(3000);
          const logRows = logs || [];
          actualCalls = logRows.length;
          actualBooked = logRows.filter((row) => {
            const payload = row.request_payload && typeof row.request_payload === 'object' ? row.request_payload : {};
            return String((payload as Record<string, unknown>).disposition || '').trim().toLowerCase() === 'booked';
          }).length;
        } else {
          const rows = records || [];
          actualCalls = rows.length;
          actualBooked = rows.filter(
            (row) => String((row as { disposition?: string }).disposition || '').trim().toLowerCase() === 'booked',
          ).length;
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          inviteId: invite?.id ? String(invite.id) : null,
          fromInvite: Boolean(invite),
          alreadySubmitted: Boolean(existingRes.data),
          weekSince,
          weekUntil,
          dailyCallTarget,
          dailyBookingTarget,
          elapsedDays,
          actualCalls: actualCalls ?? 0,
          actualBooked: actualBooked ?? 0,
          expectedCalls,
          expectedBookings,
          callsPacePct,
          bookingsPacePct,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (action === 'fullBoard') {
      if (!coachingAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const weekSince = (url.searchParams.get('weekSince') || '').trim();
      const historySince = (url.searchParams.get('historySince') || '').trim();
      const emailLimit = Math.min(120, Math.max(1, Number(url.searchParams.get('emailLimit') || '30') || 30));

      let weekInvitesQuery = admin
        .from('recruiter_performance_check_in_invites')
        .select('*')
        .order('created_at', { ascending: false });
      let weekFormsQuery = admin
        .from('recruiter_performance_check_ins')
        .select('*')
        .order('submitted_at', { ascending: false });
      if (weekSince) {
        weekInvitesQuery = weekInvitesQuery.eq('week_since', weekSince);
        weekFormsQuery = weekFormsQuery.eq('week_since', weekSince);
      }

      let historyFormsQuery = admin
        .from('recruiter_performance_check_ins')
        .select('*')
        .order('week_since', { ascending: false })
        .limit(2000);
      let historyInvitesQuery = admin
        .from('recruiter_performance_check_in_invites')
        .select('*')
        .order('week_since', { ascending: false })
        .limit(2000);
      if (historySince) {
        historyFormsQuery = historyFormsQuery.gte('week_since', historySince);
        historyInvitesQuery = historyInvitesQuery.gte('week_since', historySince);
      }

      const emailLogsPromise = admin
        .from('email_send_logs')
        .select('id, created_at, to_email, subject, status, metadata')
        .eq('trigger_label', 'mid_week_performance_checkin')
        .order('created_at', { ascending: false })
        .limit(emailLimit);

      const [weekInvitesRes, weekFormsRes, historyFormsRes, historyInvitesRes, emailRes] = await Promise.all([
        weekInvitesQuery,
        weekFormsQuery,
        historyFormsQuery,
        historyInvitesQuery,
        emailLogsPromise,
      ]);

      for (const res of [weekInvitesRes, weekFormsRes, historyFormsRes, historyInvitesRes]) {
        if (res.error && !isMissingTableError(res.error.message)) {
          return new Response(JSON.stringify({ error: res.error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      let logs = emailRes.error ? [] : (emailRes.data || []);
      if (emailRes.error && !isMissingTableError(emailRes.error.message)) {
        return new Response(JSON.stringify({ error: emailRes.error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!logs.length) {
        const fallback = await admin
          .from('email_send_logs')
          .select('id, created_at, to_email, subject, status, metadata')
          .order('created_at', { ascending: false })
          .limit(Math.min(emailLimit * 3, 120));
        if (!fallback.error) {
          logs = ((fallback.data || []) as Array<Record<string, unknown>>).filter((row) => {
            const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
            return String((meta as Record<string, unknown>).category || '') === 'mid_week_coaching';
          });
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          weekInvites: weekInvitesRes.error ? [] : weekInvitesRes.data || [],
          weekForms: weekFormsRes.error ? [] : weekFormsRes.data || [],
          historyForms: historyFormsRes.error ? [] : historyFormsRes.data || [],
          historyInvites: historyInvitesRes.error ? [] : historyInvitesRes.data || [],
          emailLogs: logs.slice(0, emailLimit),
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (action === 'emailLogs') {
      if (!coachingAdmin) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const limit = Math.min(120, Math.max(1, Number(url.searchParams.get('limit') || '30') || 30));
      const { data, error } = await admin
        .from('email_send_logs')
        .select('id, created_at, to_email, subject, status, metadata')
        .eq('trigger_label', 'mid_week_performance_checkin')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error && !isMissingTableError(error.message)) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let logs = (data || []) as Array<Record<string, unknown>>;
      if (error || !logs.length) {
        const fallback = await admin
          .from('email_send_logs')
          .select('id, created_at, to_email, subject, status, metadata')
          .order('created_at', { ascending: false })
          .limit(Math.min(limit * 3, 120));
        if (!fallback.error) {
          logs = ((fallback.data || []) as Array<Record<string, unknown>>).filter((row) => {
            const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
            return String((meta as Record<string, unknown>).category || '') === 'mid_week_coaching';
          });
        }
      }

      return new Response(
        JSON.stringify({ ok: true, logs: logs.slice(0, limit) }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('coaching-hub-data:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Request failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
