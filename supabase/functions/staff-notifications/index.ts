/**
 * Staff in-app notifications: list, sync pipeline alerts, mark read, ops/system create.
 * Deploy: supabase functions deploy staff-notifications
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const OPS_EMAILS = new Set(['ali@globelife-paz.com', 'alex@globelife-paz.com']);

type NotificationRow = {
  id: string;
  user_id: string | null;
  target_roles: string[] | null;
  category: string;
  title: string;
  body: string | null;
  link_route: string | null;
  link_label: string | null;
  metadata: Record<string, unknown>;
  dedupe_key: string | null;
  read_at: string | null;
  created_at: string;
};

function torontoWeekdayIndex(now = new Date()): number {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    weekday: 'short',
  }).format(now);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[label] ?? 0;
}

function torontoHour(now = new Date()): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    hour: 'numeric',
    hour12: false,
  }).format(now);
  return Number(h) || 0;
}

function torontoYmd(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function fridayWeekSinceYmd(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  const day = d.getUTCDay();
  const diff = day >= 5 ? day - 5 : day + 2;
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function isOpsUser(email: string | null | undefined): boolean {
  return OPS_EMAILS.has(String(email || '').trim().toLowerCase());
}

async function upsertNotification(
  admin: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
): Promise<void> {
  const userId = row.user_id as string | null;
  const dedupeKey = row.dedupe_key as string | null;
  if (!userId || !dedupeKey) {
    await admin.from('staff_notifications').insert(row);
    return;
  }
  const { data: existing } = await admin
    .from('staff_notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('dedupe_key', dedupeKey)
    .is('dismissed_at', null)
    .maybeSingle();
  if (existing?.id) {
    await admin
      .from('staff_notifications')
      .update({
        title: row.title,
        body: row.body,
        link_route: row.link_route,
        link_label: row.link_label,
        metadata: row.metadata,
        expires_at: row.expires_at ?? null,
      })
      .eq('id', existing.id);
    return;
  }
  await admin.from('staff_notifications').insert(row);
}

async function syncPipelineNotifications(
  admin: ReturnType<typeof createClient>,
  userId: string,
  role: string,
): Promise<number> {
  if (!['recruiter', 'leadership', 'webinar', 'admin', 'hr'].includes(role)) return 0;
  let created = 0;
  const now = new Date();
  const todayYmd = torontoYmd(now);
  const weekSince = fridayWeekSinceYmd(todayYmd);
  const weekStart = `${weekSince}T00:00:00.000-04:00`;

  const { data: candidates } = await admin
    .from('pipeline_candidates')
    .select('id, full_name, email, metadata, uploader_user_id, assigned_to_user_id')
    .or(`uploader_user_id.eq.${userId},assigned_to_user_id.eq.${userId}`)
    .limit(500);

  const candidateRows = candidates || [];
  const candidateIds = candidateRows.map((c) => String((c as { id: string }).id));
  const candidateNameById = new Map(
    candidateRows.map((c) => [String((c as { id: string }).id), String((c as { full_name?: string }).full_name || 'Candidate')]),
  );

  if (candidateIds.length) {
    const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data: inboxRows } = await admin
      .from('email_inbox_logs')
      .select('id, candidate_id, from_email, subject, received_at')
      .in('candidate_id', candidateIds)
      .gte('received_at', since7d)
      .order('received_at', { ascending: false })
      .limit(30);

    for (const row of inboxRows || []) {
      const cid = String((row as { candidate_id?: string }).candidate_id || '');
      const inboxId = String((row as { id: string }).id);
      const fromEmail = String((row as { from_email?: string }).from_email || '');
      const subject = String((row as { subject?: string }).subject || 'Reply received');
      const name = candidateNameById.get(cid) || fromEmail;
      await upsertNotification(admin, {
        user_id: userId,
        category: 'email_reply',
        title: `Email reply · ${name}`,
        body: subject.slice(0, 200),
        link_route: cid ? `/pipeline/email?candidateId=${encodeURIComponent(cid)}` : '/pipeline/email',
        link_label: 'Open email workspace',
        dedupe_key: `email_reply:${inboxId}`,
        metadata: { inboxLogId: inboxId, candidateId: cid, fromEmail },
        expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
      });
      created += 1;
    }
  }

  for (const c of candidateRows) {
    const row = c as {
      id: string;
      full_name?: string | null;
      metadata?: Record<string, unknown> | null;
    };
    const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const callbackAt = typeof meta.callback_at === 'string' ? meta.callback_at : null;
    if (callbackAt) {
      const due = new Date(callbackAt);
      if (!Number.isNaN(due.getTime()) && due.getTime() <= Date.now() + 86400000) {
        const overdue = due.getTime() < Date.now();
        await upsertNotification(admin, {
          user_id: userId,
          category: 'callback',
          title: overdue ? `Callback overdue · ${row.full_name || 'Lead'}` : `Callback due · ${row.full_name || 'Lead'}`,
          body: `Scheduled ${due.toLocaleString('en-CA', { timeZone: 'America/Toronto' })}`,
          link_route: `/pipeline/call?candidateId=${encodeURIComponent(row.id)}`,
          link_label: 'Open call workspace',
          dedupe_key: `callback:${row.id}:${callbackAt.slice(0, 16)}`,
          metadata: { candidateId: row.id, callbackAt },
          expires_at: new Date(due.getTime() + 3 * 86400000).toISOString(),
        });
        created += 1;
      }
    }

    const liveOutcome = String(meta.live_session_call_outcome || '').toLowerCase();
    const noShowFlag = liveOutcome === 'no_show' || String(meta.booked_outcome || '').toLowerCase().includes('no_show');
    if (noShowFlag && String(meta.no_show_called_back || '') !== 'true') {
      await upsertNotification(admin, {
        user_id: userId,
        category: 'no_show',
        title: `No-show follow-up · ${row.full_name || 'Candidate'}`,
        body: 'Booked candidate did not show — call to reschedule.',
        link_route: `/pipeline/call?candidateId=${encodeURIComponent(row.id)}`,
        link_label: 'Call now',
        dedupe_key: `no_show:${row.id}`,
        metadata: { candidateId: row.id },
        expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
      created += 1;
    }
  }

  const { data: callRecords } = await admin
    .from('pipeline_call_records')
    .select('disposition')
    .eq('recruiter_user_id', userId)
    .gte('disposed_at', weekStart)
    .limit(3000);
  const records = callRecords || [];
  const actualCalls = records.length;
  const actualBooked = records.filter(
    (r) => String((r as { disposition?: string }).disposition || '').toLowerCase() === 'booked',
  ).length;
  const weekday = torontoWeekdayIndex(now);
  const elapsed = Math.max(1, Math.min(7, weekday >= 5 ? weekday - 4 : weekday + 3));
  const expectedCalls = Math.round((105 * elapsed) / 7);
  const callsPacePct = expectedCalls > 0 ? Math.round((actualCalls / expectedCalls) * 10000) / 100 : null;

  if (
    ['recruiter', 'leadership', 'webinar'].includes(role) &&
    (weekday === 1 || weekday === 2) &&
    callsPacePct !== null &&
    callsPacePct < 50
  ) {
    const { data: existingForm } = await admin
      .from('recruiter_performance_check_ins')
      .select('id')
      .eq('user_id', userId)
      .eq('week_since', weekSince)
      .maybeSingle();
    if (!existingForm) {
      await upsertNotification(admin, {
        user_id: userId,
        category: 'check_in',
        title: 'Mid-week check-in due',
        body: `You're at ${callsPacePct}% of call pace this week. Submit your coaching form.`,
        link_route: '/performance-check-in',
        link_label: 'Complete check-in',
        dedupe_key: `check_in:${weekSince}`,
        metadata: { weekSince, callsPacePct },
        expires_at: new Date(Date.now() + 3 * 86400000).toISOString(),
      });
      created += 1;
    }
  }

  const hour = torontoHour(now);
  if (
    ['recruiter', 'leadership', 'webinar'].includes(role) &&
    hour >= 11 &&
    hour <= 16 &&
    weekday >= 1 &&
    weekday <= 5 &&
    callsPacePct !== null &&
    callsPacePct < 50
  ) {
    await upsertNotification(admin, {
      user_id: userId,
      category: 'low_dials',
      title: 'Low dial pace today',
      body: `${actualCalls} calls so far (${callsPacePct}% of mid-week target). Time to dial.`,
      link_route: '/pipeline/call',
      link_label: 'Open call workspace',
      dedupe_key: `low_dials:${todayYmd}`,
      metadata: { actualCalls, callsPacePct, actualBooked },
      expires_at: new Date(`${todayYmd}T23:59:59-04:00`).toISOString(),
    });
    created += 1;
  }

  return created;
}

async function listNotificationsForUser(
  admin: ReturnType<typeof createClient>,
  userId: string,
  role: string,
  limit = 80,
): Promise<NotificationRow[]> {
  const { data: personal, error: pErr } = await admin
    .from('staff_notifications')
    .select('*')
    .eq('user_id', userId)
    .is('dismissed_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (pErr) throw pErr;

  const { data: broadcasts, error: bErr } = await admin
    .from('staff_notifications')
    .select('*')
    .is('user_id', null)
    .is('dismissed_at', null)
    .or(`target_roles.is.null,target_roles.cs.{${role}}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (bErr) throw bErr;

  const merged = [...(personal || []), ...(broadcasts || [])] as NotificationRow[];
  merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const seen = new Set<string>();
  const out: NotificationRow[] = [];
  for (const row of merged) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

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
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await authClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRole);
    const { data: profile } = await admin
      .from('user_profiles')
      .select('role, email')
      .eq('user_id', user.id)
      .maybeSingle();
    const role = String(profile?.role || '');
    const email = String(profile?.email || user.email || '').toLowerCase();

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const action = url.searchParams.get('action') || 'list';
      if (action === 'list') {
        await syncPipelineNotifications(admin, user.id, role);
        const rows = await listNotificationsForUser(admin, user.id, role);
        const unread = rows.filter((r) => !r.read_at).length;
        return new Response(JSON.stringify({ ok: true, notifications: rows, unread }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'Unknown action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || '').trim();

    if (action === 'sync') {
      const synced = await syncPipelineNotifications(admin, user.id, role);
      const rows = await listNotificationsForUser(admin, user.id, role);
      const unread = rows.filter((r) => !r.read_at).length;
      return new Response(JSON.stringify({ ok: true, synced, notifications: rows, unread }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'mark_read') {
      const id = String(body.id || '').trim();
      if (!id) {
        return new Response(JSON.stringify({ error: 'id required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const nowIso = new Date().toISOString();
      await admin
        .from('staff_notifications')
        .update({ read_at: nowIso })
        .eq('id', id)
        .or(`user_id.eq.${user.id},user_id.is.null`);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'mark_all_read') {
      const nowIso = new Date().toISOString();
      await admin
        .from('staff_notifications')
        .update({ read_at: nowIso })
        .eq('user_id', user.id)
        .is('read_at', null)
        .is('dismissed_at', null);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'create') {
      const canCreate = role === 'admin' || role === 'leadership' || isOpsUser(email);
      if (!canCreate) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const title = String(body.title || '').trim();
      if (!title) {
        return new Response(JSON.stringify({ error: 'title required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const category = String(body.category || 'ops').trim();
      const targetUserId = typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : null;
      const targetRoles = Array.isArray(body.targetRoles)
        ? body.targetRoles.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        : null;
      const row = {
        user_id: targetUserId,
        target_roles: targetUserId ? null : (targetRoles?.length ? targetRoles : null),
        category: ['email_reply', 'check_in', 'low_dials', 'no_show', 'callback', 'ops', 'system', 'support'].includes(category)
          ? category
          : 'ops',
        title,
        body: String(body.body || '').trim() || null,
        link_route: String(body.linkRoute || '').trim() || null,
        link_label: String(body.linkLabel || '').trim() || null,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
        dedupe_key: String(body.dedupeKey || '').trim() || null,
        created_by_user_id: user.id,
        expires_at: typeof body.expiresAt === 'string' ? body.expiresAt : null,
      };
      const { data, error } = await admin.from('staff_notifications').insert(row).select('*').single();
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, notification: data }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const missing = /does not exist|schema cache|relation/i.test(message);
    return new Response(
      JSON.stringify({
        error: missing
          ? 'Notifications table not installed. Run paste_staff_notifications.sql in Supabase.'
          : message,
        ledgerMissing: missing,
      }),
      { status: missing ? 200 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
