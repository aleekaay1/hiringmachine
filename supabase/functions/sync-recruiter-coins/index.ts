// Sync Paz Coins for the signed-in user (10 per webinar/live show).
// Deploy: supabase functions deploy sync-recruiter-coins

import { createClient } from 'npm:@supabase/supabase-js@2';
import { syncRecruiterCoinsForUser } from '../_shared/recruiterCoins.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

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
    const { data: { user }, error: userErr } = await authClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const requestedUserId =
      typeof body?.userId === 'string' && body.userId.trim() ? body.userId.trim() : user.id;

    if (requestedUserId !== user.id) {
      const { data: profile } = await authClient
        .from('user_profiles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle();
      const role = profile?.role as string | undefined;
      if (role !== 'admin' && role !== 'leadership') {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const admin = createClient(supabaseUrl, serviceRole);
    const result = await syncRecruiterCoinsForUser(admin, requestedUserId);

    return new Response(
      JSON.stringify({
        ok: true,
        balance: result.balance,
        totalEvents: result.totalEvents,
        coinsPerShow: 10,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('sync-recruiter-coins error:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Sync failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
