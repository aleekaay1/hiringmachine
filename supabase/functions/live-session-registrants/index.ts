/**
 * Live session registrants for leaderboard matching (service role, explicit CORS).
 * Deploy: supabase functions deploy live-session-registrants
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const SELECT_COLS = 'session_date, email, name, phone, attended_zoom, calendly_no_show, zoom_join_at, zoom_leave_at';

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
    const sinceYmd = (url.searchParams.get('sinceYmd') || '').trim();
    const untilYmd = (url.searchParams.get('untilYmd') || '').trim();

    const admin = createClient(supabaseUrl, serviceRole);
    const registrants: Array<Record<string, unknown>> = [];
    const pageSize = 1000;
    let from = 0;

    while (from < 25_000) {
      let query = admin
        .from('live_session_registrants')
        .select(SELECT_COLS)
        .order('session_date', { ascending: true })
        .range(from, from + pageSize - 1);
      if (sinceYmd) query = query.gte('session_date', sinceYmd);
      if (untilYmd) query = query.lte('session_date', untilYmd);

      const { data, error } = await query;
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const batch = data || [];
      registrants.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
    }

    return new Response(JSON.stringify({ ok: true, registrants }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('live-session-registrants:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Request failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
