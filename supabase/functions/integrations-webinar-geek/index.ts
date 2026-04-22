import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const WEBINARGEEK_BASE = (Deno.env.get('WEBINARGEEK_API_BASE_URL')?.trim() || 'https://app.webinargeek.com/api/v2').replace(/\/$/, '');

function parseBool(value: string | null): boolean | undefined {
  if (value == null) return undefined;
  if (value === '1' || value.toLowerCase() === 'true') return true;
  if (value === '0' || value.toLowerCase() === 'false') return false;
  return undefined;
}

async function wgRequest(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const token = Deno.env.get('WEBINARGEEK_API_TOKEN')?.trim();
  if (!token) throw new Error('Missing WEBINARGEEK_API_TOKEN secret');
  const url = `${WEBINARGEEK_BASE}${path.startsWith('/') ? '' : '/'}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Api-Token': token,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

async function wgGet(path: string, params?: Record<string, string | number | boolean | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || String(v).length === 0) continue;
    sp.set(k, String(v));
  }
  const suffix = sp.size > 0 ? `?${sp.toString()}` : '';
  return wgRequest(`${path}${suffix}`, { method: 'GET' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
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
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const mode = (url.searchParams.get('mode') || 'dashboard').trim();

    if (req.method === 'GET' && mode === 'health') {
      const ping = await wgGet('/account');
      return new Response(JSON.stringify({
        ok: ping.ok,
        status: ping.status,
        connected: ping.ok,
        error: ping.ok ? null : (ping.json.error || ping.json.message || 'WebinarGeek request failed'),
      }), {
        status: ping.ok ? 200 : 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && mode === 'dashboard') {
      const webinarId = url.searchParams.get('webinar_id')?.trim();
      const broadcastId = url.searchParams.get('broadcast_id')?.trim();
      const perPage = Number(url.searchParams.get('per_page') || '50');
      const watched = parseBool(url.searchParams.get('watched_webinar'));
      const watchedLive = parseBool(url.searchParams.get('watched_live'));
      const watchedReplay = parseBool(url.searchParams.get('watched_replay'));

      const [account, webinars, broadcasts, subscriptions, messages, questions] = await Promise.all([
        wgGet('/account'),
        wgGet('/webinars'),
        wgGet('/broadcasts', webinarId ? { webinar_id: webinarId } : undefined),
        wgGet('/subscriptions', {
          webinar_id: webinarId || undefined,
          broadcast_id: broadcastId || undefined,
          watched_webinar: watched,
          watched_live: watchedLive,
          watched_replay: watchedReplay,
          nested_resources: 'broadcast,episode,webinar',
        }),
        wgGet('/messages'),
        wgGet('/questions', { per_page: Math.min(Math.max(perPage, 1), 100) }),
      ]);

      const selectedWebinar = webinarId ? await wgGet(`/webinars/${webinarId}`) : null;
      const selectedBroadcast = broadcastId ? await wgGet(`/broadcasts/${broadcastId}`) : null;

      const response = {
        ok: true,
        generated_at: new Date().toISOString(),
        filters: {
          webinar_id: webinarId || null,
          broadcast_id: broadcastId || null,
          watched_webinar: watched ?? null,
          watched_live: watchedLive ?? null,
          watched_replay: watchedReplay ?? null,
        },
        account: account.json,
        webinars: webinars.json,
        broadcasts: broadcasts.json,
        subscriptions: subscriptions.json,
        questions: questions.json,
        messages: messages.json,
        selected_webinar: selectedWebinar?.json || null,
        selected_broadcast: selectedBroadcast?.json || null,
        health: {
          account_ok: account.ok,
          webinars_ok: webinars.ok,
          broadcasts_ok: broadcasts.ok,
          subscriptions_ok: subscriptions.ok,
          questions_ok: questions.ok,
          messages_ok: messages.ok,
        },
      };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unsupported mode' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
