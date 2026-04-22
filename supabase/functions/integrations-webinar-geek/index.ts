import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
  if (req.method !== 'GET' && req.method !== 'POST') {
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
    const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
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

      const [account, webinars, broadcasts, subscriptions] = await Promise.all([
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
        selected_webinar: selectedWebinar?.json || null,
        selected_broadcast: selectedBroadcast?.json || null,
        health: {
          account_ok: account.ok,
          webinars_ok: webinars.ok,
          broadcasts_ok: broadcasts.ok,
          subscriptions_ok: subscriptions.ok,
        },
      };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST' && mode === 'sync') {
      const body = (await req.json().catch(() => ({}))) as {
        webinar_id?: string;
        broadcast_id?: string;
        per_page?: number;
      };
      const webinarId = String(body.webinar_id || '').trim();
      const broadcastId = String(body.broadcast_id || '').trim();
      const perPage = Number(body.per_page || 250);

      const subscriptions = await wgGet('/subscriptions', {
        webinar_id: webinarId || undefined,
        broadcast_id: broadcastId || undefined,
        nested_resources: 'broadcast,episode,webinar',
        per_page: Number.isFinite(perPage) ? perPage : 250,
      });
      if (!subscriptions.ok) {
        return new Response(JSON.stringify({
          error: String(subscriptions.json.error || subscriptions.json.message || 'Unable to fetch WebinarGeek subscriptions'),
          source_status: subscriptions.status,
        }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const subRows = Array.isArray(subscriptions.json.subscriptions)
        ? subscriptions.json.subscriptions as Array<Record<string, unknown>>
        : [];

      const { data: candidates, error: candErr } = await admin
        .from('candidates')
        .select('id,email,first_name,last_name,admin_data')
        .limit(5000);
      if (candErr) throw candErr;

      const byEmail = new Map<string, Record<string, unknown>>();
      const byName = new Map<string, Record<string, unknown>>();
      for (const c of candidates || []) {
        const email = String((c as Record<string, unknown>).email || '').trim().toLowerCase();
        const first = String((c as Record<string, unknown>).first_name || '').trim().toLowerCase();
        const last = String((c as Record<string, unknown>).last_name || '').trim().toLowerCase();
        if (email) byEmail.set(email, c as Record<string, unknown>);
        if (first || last) byName.set(`${first}|${last}`, c as Record<string, unknown>);
      }

      const matchedByCandidate = new Map<string, Array<Record<string, unknown>>>();
      const unmatched: Array<Record<string, unknown>> = [];
      let emailMatches = 0;
      let nameMatches = 0;

      for (const row of subRows) {
        const email = String(row.email || '').trim().toLowerCase();
        const first = String(row.firstname || '').trim().toLowerCase();
        const last = String(row.surname || '').trim().toLowerCase();
        let candidate = byEmail.get(email);
        let matchMethod: 'email' | 'name' | null = null;
        if (candidate) {
          matchMethod = 'email';
          emailMatches += 1;
        } else {
          candidate = byName.get(`${first}|${last}`);
          if (candidate) {
            matchMethod = 'name';
            nameMatches += 1;
          }
        }
        if (!candidate) {
          unmatched.push({
            subscription_id: row.id || null,
            email: row.email || null,
            firstname: row.firstname || null,
            surname: row.surname || null,
          });
          continue;
        }
        const cid = String(candidate.id);
        if (!matchedByCandidate.has(cid)) matchedByCandidate.set(cid, []);
        matchedByCandidate.get(cid)!.push({ ...row, _match_method: matchMethod });
      }

      let updatedCandidates = 0;
      const nowIso = new Date().toISOString();
      for (const c of candidates || []) {
        const cid = String((c as Record<string, unknown>).id || '');
        const rows = matchedByCandidate.get(cid);
        if (!rows || rows.length === 0) continue;

        const watchedCount = rows.filter((r) => r.watched === true).length;
        const watchedLiveCount = rows.filter((r) => r.watched_live === true).length;
        const watchedReplayCount = rows.filter((r) => r.watched_replay === true).length;
        const totalWatchDuration = rows.reduce((s, r) => s + Number(r.watch_duration || 0), 0);
        const ips = Array.from(new Set(rows.map((r) => String(r.registration_ip || '').trim()).filter(Boolean)));
        const sources = Array.from(new Set(rows.map((r) => String(r.registration_source || '').trim()).filter(Boolean)));

        const webinarGeekData = {
          synced_at: nowIso,
          source: 'webinargeek',
          total_subscriptions: rows.length,
          watched_count: watchedCount,
          watched_live_count: watchedLiveCount,
          watched_replay_count: watchedReplayCount,
          total_watch_duration: totalWatchDuration,
          latest_watch_start: rows
            .map((r) => Number(r.watch_start || 0))
            .filter((n) => Number.isFinite(n) && n > 0)
            .sort((a, b) => b - a)[0] ?? null,
          latest_watch_end: rows
            .map((r) => Number(r.watch_end || 0))
            .filter((n) => Number.isFinite(n) && n > 0)
            .sort((a, b) => b - a)[0] ?? null,
          registration_ips: ips,
          registration_sources: sources,
          records: rows.map((r) => ({
            subscription_id: r.id || null,
            email: r.email || null,
            firstname: r.firstname || null,
            surname: r.surname || null,
            watched: r.watched === true,
            watched_live: r.watched_live === true,
            watched_replay: r.watched_replay === true,
            watch_duration: Number(r.watch_duration || 0),
            watch_duration_live: Number(r.watch_duration_live || 0),
            watch_duration_replay: Number(r.watch_duration_replay || 0),
            watched_true_set_at: r.watched_true_set_at || null,
            watch_start: r.watch_start || null,
            watch_end: r.watch_end || null,
            registration_source: r.registration_source || null,
            registration_ip: r.registration_ip || null,
            unsubscribed: r.unsubscribed === true,
            broadcast: r.broadcast || null,
            webinar: r.webinar || null,
            episode: r.episode || null,
            created_at: r.created_at || null,
            match_method: r._match_method || null,
          })),
        };

        const existingAdmin = (c as Record<string, unknown>).admin_data && typeof (c as Record<string, unknown>).admin_data === 'object'
          ? ((c as Record<string, unknown>).admin_data as Record<string, unknown>)
          : {};
        const nextAdmin = {
          ...existingAdmin,
          webinarGeek: webinarGeekData,
        };
        const { error: upErr } = await admin.from('candidates').update({ admin_data: nextAdmin }).eq('id', cid);
        if (upErr) throw upErr;
        updatedCandidates += 1;
      }

      return new Response(JSON.stringify({
        ok: true,
        synced_at: nowIso,
        filters: {
          webinar_id: webinarId || null,
          broadcast_id: broadcastId || null,
          per_page: perPage,
        },
        total_subscriptions: subRows.length,
        matched_subscriptions: Array.from(matchedByCandidate.values()).reduce((s, rows) => s + rows.length, 0),
        unmatched_subscriptions: unmatched.length,
        matched_candidates: matchedByCandidate.size,
        updated_candidates: updatedCandidates,
        match_breakdown: {
          email_matches: emailMatches,
          name_matches: nameMatches,
        },
        unmatched_samples: unmatched.slice(0, 25),
      }), {
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
