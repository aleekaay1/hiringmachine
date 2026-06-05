/**
 * Dashboard / leaderboard data via Edge Function (explicit CORS) when browser REST calls fail.
 * Deploy: supabase functions deploy dashboard-team-metrics
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

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

    const url = new URL(req.url);
    const period = (url.searchParams.get('period') || 'last7').trim();

    const admin = createClient(supabaseUrl, serviceRole);

    const { data: viewerProfile } = await admin
      .from('user_profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    const role = String(viewerProfile?.role || '');
    const canReadTeam = role === 'admin' || role === 'leadership';

    const { data: snapshotRow, error: snapErr } = await admin
      .from('pipeline_leaderboard_snapshots')
      .select('period, payload, fetched_at')
      .eq('period', period)
      .maybeSingle();

    if (snapErr) {
      return new Response(JSON.stringify({ error: snapErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let profiles: Array<Record<string, unknown>> = [];
    const roleCounts: Record<string, number> = {};
    if (canReadTeam) {
      const { data: profileRows, error: profErr } = await admin
        .from('user_profiles')
        .select('user_id, email, full_name, role, points, points_updated_at')
        .order('full_name', { ascending: true })
        .order('email', { ascending: true });
      if (profErr) {
        const { data: fallbackRows, error: fallbackErr } = await admin
          .from('user_profiles')
          .select('user_id, email, full_name, role')
          .order('email', { ascending: true });
        if (fallbackErr) {
          return new Response(JSON.stringify({ error: fallbackErr.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        profiles = (fallbackRows || []) as Array<Record<string, unknown>>;
      } else {
        profiles = (profileRows || []) as Array<Record<string, unknown>>;
      }
      for (const row of profiles) {
        const r = String(row.role || 'viewer');
        roleCounts[r] = (roleCounts[r] || 0) + 1;
      }
    }

    const payload = (snapshotRow?.payload || {}) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        ok: true,
        snapshot: snapshotRow
          ? {
              period: String(snapshotRow.period || period),
              rows: Array.isArray(payload.rows) ? payload.rows : [],
              previousRows: Array.isArray(payload.previousRows) ? payload.previousRows : [],
              windowLabel: String(payload.windowLabel || ''),
              fetchedAt: snapshotRow.fetched_at ?? null,
            }
          : null,
        profiles: canReadTeam ? profiles : [],
        roleCounts,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('dashboard-team-metrics:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Request failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
