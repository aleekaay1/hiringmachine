import {
  corsHeaders,
  cronSecretOk,
  instantlyFetch,
  json,
  serviceClient,
  sumInstantlyAnalytics,
  userIsAuthenticated,
} from '../_shared/hiringMachine.ts';

type DailyPoint = { date: string; sent: number; opened: number; replies: number };

function parseDaily(rows: unknown[]): DailyPoint[] {
  const byDate = new Map<string, DailyPoint>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const obj = row as Record<string, unknown>;
    const date = String(obj.date || obj.day || obj.timestamp || '').slice(0, 10);
    if (!date) continue;
    const current = byDate.get(date) || { date, sent: 0, opened: 0, replies: 0 };
    const totals = sumInstantlyAnalytics([obj]);
    current.sent += totals.sent;
    current.opened += totals.opened;
    current.replies += totals.replies;
    byDate.set(date, current);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method === 'GET') return json(200, { ok: true, service: 'hm-instantly-metrics' });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const admin = serviceClient();
  const cronOk = cronSecretOk(req);
  const userOk = await userIsAuthenticated(req, admin);
  if (!cronOk && !userOk) return json(401, { error: 'Unauthorized' });

  const campaignIds = (Deno.env.get('INSTANTLY_CAMPAIGN_IDS') || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  const qs = new URLSearchParams();
  for (const id of campaignIds) {
    qs.append('id', id);
    qs.append('ids', id);
    qs.append('campaign_id', id);
  }
  // Instantly UI "Last 4 weeks" — without start_date the API can return a shorter default window.
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 90);
  qs.set('start_date', start.toISOString().slice(0, 10));

  const analyticsPath = `/api/v2/campaigns/analytics${qs.toString() ? `?${qs}` : ''}`;
  const dailyPath = `/api/v2/campaigns/analytics/daily${qs.toString() ? `?${qs}` : ''}`;
  const overviewPath = `/api/v2/campaigns/analytics/overview${qs.toString() ? `?${qs}` : ''}`;

  const [analyticsRes, dailyRes, overviewRes] = await Promise.all([
    instantlyFetch(analyticsPath),
    instantlyFetch(dailyPath),
    instantlyFetch(overviewPath),
  ]);

  const analyticsJson = await analyticsRes.json().catch(() => null);
  const dailyJson = await dailyRes.json().catch(() => null);
  const overviewJson = await overviewRes.json().catch(() => null);
  if (!analyticsRes.ok) {
    return json(502, { error: 'Instantly analytics failed', detail: analyticsJson });
  }

  const analyticsRows = Array.isArray(analyticsJson)
    ? analyticsJson
    : Array.isArray((analyticsJson as { items?: unknown[] })?.items)
      ? (analyticsJson as { items: unknown[] }).items
      : analyticsJson
        ? [analyticsJson]
        : [];
  const dailyRows = Array.isArray(dailyJson)
    ? dailyJson
    : Array.isArray((dailyJson as { items?: unknown[] })?.items)
      ? (dailyJson as { items: unknown[] }).items
      : [];
  const overviewRows = Array.isArray(overviewJson)
    ? overviewJson
    : overviewJson && typeof overviewJson === 'object'
      ? [overviewJson]
      : [];

  const totals = sumInstantlyAnalytics(analyticsRows);
  const overviewTotals = overviewRes.ok ? sumInstantlyAnalytics(overviewRows) : totals;
  totals.sent = Math.max(totals.sent, overviewTotals.sent);
  totals.opened = Math.max(totals.opened, overviewTotals.opened);
  totals.replies = Math.max(totals.replies, overviewTotals.replies);
  totals.interested = Math.max(totals.interested, overviewTotals.interested);
  const daily = parseDaily(dailyRows);
  const payload = {
    totals,
    daily,
    campaigns: analyticsRows,
    campaign_ids: campaignIds,
  };

  const { error } = await admin.from('hm_metrics_cache').upsert({
    cache_key: 'instantly_overview',
    payload,
    pulled_at: new Date().toISOString(),
  });
  if (error) return json(500, { error: error.message });

  return json(200, { ok: true, totals, days: daily.length });
});
