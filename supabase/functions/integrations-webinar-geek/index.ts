import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const WEBINARGEEK_BASE = (Deno.env.get('WEBINARGEEK_API_BASE_URL')?.trim() || 'https://app.webinargeek.com/api/v2').replace(/\/$/, '');

function deriveInviterSignal(row: Record<string, unknown>): string | null {
  const extraFields = row.extra_fields && typeof row.extra_fields === 'object'
    ? row.extra_fields as Record<string, unknown>
    : null;
  const candidates = [
    row.inviter_name,
    row.invited_by,
    row.invited_by_name,
    row.utm_source,
    row.utm_term,
    row.utm_content,
    row.custom_field,
    row.registration_page_name,
    row.referrer_name,
    row.affiliate_name,
  ];
  for (const v of candidates) {
    const s = String(v || '').trim();
    if (s && s.toLowerCase() !== 'registration_page') return s;
  }
  const source = String(row.registration_source || '').trim();
  if (source && source.toLowerCase() !== 'registration_page') return source;
  if (extraFields) {
    for (const v of Object.values(extraFields)) {
      const s = String(v || '').trim();
      if (s && s.toLowerCase() !== 'registration_page') return s;
    }
  }
  return null;
}

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

function subscriptionRowEventMs(row: Record<string, unknown>): number | null {
  const broadcast = row.broadcast && typeof row.broadcast === 'object' ? row.broadcast as Record<string, unknown> : null;
  const candidates = [broadcast?.date, row.created_at, row.watched_true_set_at];
  let best: number | null = null;
  for (const v of candidates) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) continue;
    const ms = n > 1e12 ? n : n * 1000;
    if (best == null || ms > best) best = ms;
  }
  return best;
}

function parseYmdToUtcStartMs(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
}

function parseYmdToUtcEndMs(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
}

function rowInWindow(row: Record<string, unknown>, sinceMs: number | null, untilMs: number | null): boolean {
  const ms = subscriptionRowEventMs(row);
  if (ms == null) return sinceMs == null && untilMs == null;
  if (sinceMs != null && ms < sinceMs) return false;
  if (untilMs != null && ms > untilMs) return false;
  return true;
}

/** Default list excludes people who have not confirmed email (WG docs). Prefer primary row on id clash (watch stats). */
function mergeSubscriptionsPreferFirst(
  primary: Array<Record<string, unknown>>,
  secondary: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of primary) {
    const id = r.id;
    if (id == null || id === '') continue;
    byId.set(String(id), r);
  }
  for (const r of secondary) {
    const id = r.id;
    if (id == null || id === '') continue;
    const key = String(id);
    if (!byId.has(key)) byId.set(key, r);
  }
  return [...byId.values()];
}

async function wgGetAllSubscriptionsOnePass(
  params: Record<string, string | number | boolean | undefined>,
  opts?: { sinceMs?: number | null; untilMs?: number | null; maxPages?: number },
) {
  const perPage = Math.min(1000, Math.max(50, Number(params.per_page || 250)));
  const sinceMs = opts?.sinceMs ?? null;
  const untilMs = opts?.untilMs ?? null;
  const maxPages = Math.min(500, Math.max(1, Number(opts?.maxPages ?? 40)));
  const rows: Array<Record<string, unknown>> = [];
  let page = 1;
  let totalPages = 1;
  for (let guard = 0; guard < maxPages; guard++) {
    const res = await wgGet('/subscriptions', {
      ...params,
      per_page: perPage,
      page,
    });
    if (!res.ok) return { ...res, rows, pagesFetched: page - 1, totalPages };
    const pageRows = Array.isArray(res.json.subscriptions)
      ? (res.json.subscriptions as Array<Record<string, unknown>>)
      : [];
    const filtered = sinceMs != null || untilMs != null
      ? pageRows.filter((r) => rowInWindow(r, sinceMs, untilMs))
      : pageRows;
    rows.push(...filtered);

    const pageTimes = pageRows.map(subscriptionRowEventMs).filter((n): n is number => n != null);
    const oldestOnPage = pageTimes.length ? Math.min(...pageTimes) : null;
    const newestOnPage = pageTimes.length ? Math.max(...pageTimes) : null;

    const pages = (res.json.pages && typeof res.json.pages === 'object')
      ? (res.json.pages as Record<string, unknown>)
      : {};
    totalPages = Number(pages.total_pages || totalPages || 1);
    const nextLink = typeof pages.next === 'string' ? pages.next : null;

    if (sinceMs != null && pageRows.length > 0 && oldestOnPage != null && newestOnPage != null && newestOnPage < sinceMs) {
      break;
    }

    if (!nextLink || page >= totalPages) {
      return { ok: true as const, status: res.status, json: { ...res.json, subscriptions: rows }, rows, pagesFetched: page, totalPages };
    }
    page += 1;
  }
  return { ok: true as const, status: 200, json: { subscriptions: rows }, rows, pagesFetched: page - 1, totalPages };
}

/**
 * Fetches subscriptions and merges an extra pass with `email_verified=false` so invited people who have not
 * confirmed their email in WebinarGeek still appear (default GET list omits them per WG docs).
 * Set WEBINARGEEK_SUBSCRIPTIONS_SKIP_UNVERIFIED_PASS=1 to disable the extra pass (fewer API calls).
 */
async function wgGetAllSubscriptions(
  params: Record<string, string | number | boolean | undefined>,
  opts?: { sinceMs?: number | null; untilMs?: number | null; maxPages?: number },
) {
  const primary = await wgGetAllSubscriptionsOnePass(params, opts);
  if (!primary.ok) return { ...primary, unverified_pass: 'not_applicable' };

  const skipExtra = Deno.env.get('WEBINARGEEK_SUBSCRIPTIONS_SKIP_UNVERIFIED_PASS') === '1';
  if (skipExtra) {
    return { ...primary, unverified_pass: 'skipped_env' };
  }

  if (params.email_verified === false) {
    return { ...primary, unverified_pass: 'not_applicable' };
  }

  let secondary = await wgGetAllSubscriptionsOnePass({ ...params, email_verified: false }, opts);
  let unverifiedStrategy: 'email_verified_false' | 'include_unverified_true' = 'email_verified_false';
  if (!secondary.ok) {
    secondary = await wgGetAllSubscriptionsOnePass({ ...params, include_unverified: true }, opts);
    unverifiedStrategy = 'include_unverified_true';
  }
  if (!secondary.ok) {
    return {
      ...primary,
      unverified_pass: 'failed',
      pages_fetched_unverified: secondary.pagesFetched ?? 0,
    };
  }

  const mergedRows = mergeSubscriptionsPreferFirst(primary.rows, secondary.rows);
  if (mergedRows.length === primary.rows.length) {
    return {
      ...primary,
      unverified_pass: 'skipped_duplicate',
      pages_fetched_unverified: secondary.pagesFetched ?? 0,
      unverified_strategy: unverifiedStrategy,
    };
  }

  return {
    ok: true,
    status: primary.status,
    json: { ...primary.json, subscriptions: mergedRows },
    rows: mergedRows,
    pagesFetched: primary.pagesFetched,
    totalPages: Math.max(primary.totalPages ?? 1, secondary.totalPages ?? 1),
    unverified_pass: 'ok',
    pages_fetched_unverified: secondary.pagesFetched ?? 0,
    unverified_strategy: unverifiedStrategy,
  };
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
      const perPage = Number(url.searchParams.get('per_page') || '250');
      const watched = parseBool(url.searchParams.get('watched_webinar'));
      const watchedLive = parseBool(url.searchParams.get('watched_live'));
      const watchedReplay = parseBool(url.searchParams.get('watched_replay'));
      const since = url.searchParams.get('since')?.trim() || '';
      const until = url.searchParams.get('until')?.trim() || '';
      const includeCatalog = url.searchParams.get('include_catalog') !== '0';
      const maxPages = Math.min(80, Math.max(1, Number(url.searchParams.get('max_pages') || '20')));

      const sinceMs = since ? parseYmdToUtcStartMs(since) : null;
      const untilMs = until ? parseYmdToUtcEndMs(until) : null;

      const account = await wgGet('/account');
      const webinars = includeCatalog
        ? await wgGet('/webinars')
        : { ok: true as const, status: 200, json: { webinars: [] as unknown[] } };
      const broadcasts = includeCatalog
        ? await wgGet('/broadcasts', webinarId ? { webinar_id: webinarId } : undefined)
        : { ok: true as const, status: 200, json: { broadcasts: [] as unknown[] } };

      const subscriptions = await wgGetAllSubscriptions({
        webinar_id: webinarId || undefined,
        broadcast_id: broadcastId || undefined,
        watched_webinar: watched,
        watched_live: watchedLive,
        watched_replay: watchedReplay,
        nested_resources: 'broadcast,episode,webinar',
        per_page: Number.isFinite(perPage) ? perPage : 250,
      }, { sinceMs, untilMs, maxPages });

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
          since: since || null,
          until: until || null,
          include_catalog: includeCatalog,
          max_pages: maxPages,
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
        subscriptions_pagination: {
          pages_fetched: subscriptions.pagesFetched ?? 1,
          total_pages: subscriptions.totalPages ?? 1,
          total_rows: Array.isArray((subscriptions.json as Record<string, unknown>).subscriptions)
            ? ((subscriptions.json as Record<string, unknown>).subscriptions as Array<unknown>).length
            : 0,
          unverified_email_pass: (subscriptions as { unverified_pass?: string }).unverified_pass ?? null,
          pages_fetched_unverified_pass: (subscriptions as { pages_fetched_unverified?: number }).pages_fetched_unverified ?? null,
          unverified_merge_strategy: (subscriptions as { unverified_strategy?: string }).unverified_strategy ?? null,
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
        since?: string;
        until?: string;
        max_pages?: number;
      };
      const webinarId = String(body.webinar_id || '').trim();
      const broadcastId = String(body.broadcast_id || '').trim();
      const perPage = Number(body.per_page || 250);
      const since = String(body.since || '').trim();
      const until = String(body.until || '').trim();
      const maxPages = Math.min(80, Math.max(1, Number(body.max_pages || 25)));
      const sinceMs = since ? parseYmdToUtcStartMs(since) : null;
      const untilMs = until ? parseYmdToUtcEndMs(until) : null;

      const subscriptions = await wgGetAllSubscriptions({
        webinar_id: webinarId || undefined,
        broadcast_id: broadcastId || undefined,
        nested_resources: 'broadcast,episode,webinar',
        per_page: Number.isFinite(perPage) ? perPage : 250,
      }, { sinceMs, untilMs, maxPages });
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

      const broadcastsOverview = await wgGet('/broadcasts', webinarId ? { webinar_id: webinarId } : undefined);
      const broadcastRows = Array.isArray(broadcastsOverview.json.broadcasts)
        ? broadcastsOverview.json.broadcasts as Array<Record<string, unknown>>
        : [];
      const broadcastSubscriptionsTotal = broadcastRows.reduce((s, b) => s + Number(b.subscriptions_count || 0), 0);
      const estimatedUnverifiedOrPending = Math.max(0, broadcastSubscriptionsTotal - subRows.length);

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
        const inviterSignals = Array.from(new Set(rows.map((r) => deriveInviterSignal(r)).filter((v): v is string => Boolean(v))));

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
          inviter_signals: inviterSignals,
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
            custom_field: r.custom_field || null,
            extra_fields: r.extra_fields || null,
            inviter_signal: deriveInviterSignal(r),
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
          since: since || null,
          until: until || null,
          max_pages: maxPages,
          pages_fetched: subscriptions.pagesFetched ?? 1,
          total_pages: subscriptions.totalPages ?? 1,
        },
        total_subscriptions: subRows.length,
        broadcast_subscriptions_total: broadcastSubscriptionsTotal,
        estimated_unverified_or_pending: estimatedUnverifiedOrPending,
        unverified_email_pass: (subscriptions as { unverified_pass?: string }).unverified_pass ?? null,
        pages_fetched_unverified_pass: (subscriptions as { pages_fetched_unverified?: number }).pages_fetched_unverified ?? null,
        unverified_merge_strategy: (subscriptions as { unverified_strategy?: string }).unverified_strategy ?? null,
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
