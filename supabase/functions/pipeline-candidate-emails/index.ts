/**
 * Returns pipeline_candidates id → email for leaderboard refresh (service role).
 * Deploy: supabase functions deploy pipeline-candidate-emails
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

function normEmail(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
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

    const { data: profile } = await authClient
      .from('user_profiles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    const role = String(profile?.role || '');
    const isTeamViewer = role === 'admin' || role === 'leadership';

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const rawIds = Array.isArray(body.candidateIds) ? body.candidateIds : [];
    const candidateIds = [
      ...new Set(rawIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)),
    ];
    if (!candidateIds.length) {
      return new Response(JSON.stringify({ ok: true, emails: {} }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRole);
    const emails: Record<string, string> = {};
    const chunk = 200;

    for (let i = 0; i < candidateIds.length; i += chunk) {
      const slice = candidateIds.slice(i, i + chunk);
      let query = admin.from('pipeline_candidates').select('id, email, uploader_user_id').in('id', slice);
      if (!isTeamViewer) {
        query = query.eq('uploader_user_id', user.id);
      }
      const { data, error } = await query;
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      for (const row of data || []) {
        const id = String((row as { id?: string }).id || '').trim();
        const email = normEmail((row as { email?: string }).email);
        if (id && email) emails[id] = email;
      }
    }

    return new Response(JSON.stringify({ ok: true, emails }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('pipeline-candidate-emails:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Request failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
