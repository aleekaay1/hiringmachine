/**
 * Ali-only ops console: tickets admin + health checks (manual refresh)
 * Deploy: supabase functions deploy ops-console
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const OPS_EMAILS = new Set(['ali@globelife-paz.com']);
const PRODUCTION_APP_URL = (Deno.env.get('OPS_APP_URL') || 'https://paz-talent-journey.vercel.app').replace(/\/$/, '');

function isOpsUser(email: string | null | undefined): boolean {
  const normalized = String(email || '').trim().toLowerCase();
  return OPS_EMAILS.has(normalized);
}

async function probeUrl(
  label: string,
  url: string,
  init?: RequestInit,
  timeoutMs = 12000,
): Promise<Record<string, unknown>> {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return {
      label,
      url,
      ok: res.ok,
      status: res.status,
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    return {
      label,
      url,
      ok: false,
      status: 0,
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function runHealthChecks(admin: ReturnType<typeof createClient>): Promise<Record<string, unknown>> {
  const checks: Array<Record<string, unknown>> = [];
  const started = Date.now();
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() || '';

  const profileProbe = await admin.from('user_profiles').select('user_id', { count: 'exact', head: true });
  checks.push({
    label: 'Supabase · user_profiles',
    ok: !profileProbe.error,
    detail: profileProbe.error?.message || `rows accessible (${profileProbe.count ?? 'ok'})`,
  });

  const ticketsProbe = await admin.from('support_tickets').select('id', { count: 'exact', head: true });
  checks.push({
    label: 'Supabase · support_tickets',
    ok: !ticketsProbe.error,
    detail: ticketsProbe.error?.message || `table ok (${ticketsProbe.count ?? 0} tickets)`,
  });

  const emailLogsProbe = await admin
    .from('email_send_logs')
    .select('id,status,created_at')
    .order('created_at', { ascending: false })
    .limit(5);
  const recentEmailFailures = (emailLogsProbe.data || []).filter(
    (row) => String((row as Record<string, unknown>).status || '').toLowerCase() === 'failed',
  );
  checks.push({
    label: 'Supabase · email_send_logs',
    ok: !emailLogsProbe.error,
    detail: emailLogsProbe.error?.message || `${recentEmailFailures.length} recent failed in last 5 rows`,
  });

  checks.push(await probeUrl('Vercel app', PRODUCTION_APP_URL));

  if (serviceRole && supabaseUrl) {
    const restProbe = await probeUrl('Supabase REST · user_profiles', `${supabaseUrl}/rest/v1/user_profiles?select=user_id&limit=1`, {
      method: 'GET',
      headers: {
        apikey: serviceRole,
        Authorization: `Bearer ${serviceRole}`,
      },
    });
    checks.push({
      ...restProbe,
      label: 'Supabase REST',
      detail: restProbe.ok ? 'Authenticated REST query ok' : 'REST query failed',
    });
  } else {
    checks.push({
      label: 'Supabase REST',
      ok: false,
      detail: 'Skipped — missing service role key in edge secrets',
    });
  }

  const edgeBase = `${supabaseUrl}/functions/v1`;
  const edgeOptionsProbe = await probeUrl('Edge · dashboard-team-metrics', `${edgeBase}/dashboard-team-metrics`, {
    method: 'OPTIONS',
  });
  checks.push({
    ...edgeOptionsProbe,
    label: 'Edge · dashboard-team-metrics',
    ok: edgeOptionsProbe.status === 204,
    detail:
      edgeOptionsProbe.status === 204
        ? 'Edge function reachable (CORS preflight ok)'
        : `Expected 204 preflight, got HTTP ${edgeOptionsProbe.status ?? 0}`,
  });

  const openTickets = await admin
    .from('support_tickets')
    .select('id', { count: 'exact', head: true })
    .in('status', ['open', 'in_progress']);
  checks.push({
    label: 'Support queue',
    ok: true,
    detail: `${openTickets.count ?? 0} open / in progress`,
  });

  const overallOk = checks.every((c) => c.ok !== false);
  return {
    capturedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    overallOk,
    checks,
    appUrl: PRODUCTION_APP_URL,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
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
    if (userErr || !user || !isOpsUser(user.email)) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRole);
    const url = new URL(req.url);

    if (req.method === 'GET') {
      const action = url.searchParams.get('action') || 'health';

      if (action === 'tickets') {
        const status = url.searchParams.get('status');
        let query = admin
          .from('support_tickets')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(200);
        if (status) query = query.eq('status', status);
        const { data, error } = await query;
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ tickets: data || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'ticket_events') {
        const ticketId = url.searchParams.get('ticketId');
        if (!ticketId) {
          return new Response(JSON.stringify({ error: 'ticketId required' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        const { data, error } = await admin
          .from('support_ticket_events')
          .select('*')
          .eq('ticket_id', ticketId)
          .order('created_at', { ascending: true });
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ events: data || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'health_history') {
        const { data, error } = await admin
          .from('ops_health_snapshots')
          .select('id, created_at, payload')
          .order('created_at', { ascending: false })
          .limit(20);
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ snapshots: data || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const payload = await runHealthChecks(admin);
      const { data: saved, error: saveErr } = await admin
        .from('ops_health_snapshots')
        .insert({ captured_by_user_id: user.id, payload })
        .select('id, created_at')
        .single();
      return new Response(
        JSON.stringify({
          health: payload,
          saved: saveErr ? null : saved,
          saveError: saveErr?.message || null,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const action = String(body?.action || '').trim();

      if (action === 'update_ticket') {
        const ticketId = String(body?.ticketId || '').trim();
        const status = String(body?.status || '').trim();
        const resolutionNote = String(body?.resolutionNote || '').trim() || null;
        const staffMessage = String(body?.staffMessage || '').trim() || null;
        const validStatuses = new Set(['open', 'in_progress', 'resolved', 'closed']);

        if (!ticketId || !validStatuses.has(status)) {
          return new Response(JSON.stringify({ error: 'Invalid ticket update' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const nowIso = new Date().toISOString();
        const { data: ticket, error: updateErr } = await admin
          .from('support_tickets')
          .update({
            status,
            resolution_note: resolutionNote,
            updated_at: nowIso,
          })
          .eq('id', ticketId)
          .select('*')
          .single();

        if (updateErr || !ticket) {
          return new Response(JSON.stringify({ error: updateErr?.message || 'Update failed' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const events: Array<Record<string, unknown>> = [];
        events.push({
          ticket_id: ticketId,
          actor_user_id: user.id,
          actor_email: user.email,
          event_type: status === 'resolved' || status === 'closed' ? 'resolution' : 'status_change',
          message: staffMessage || resolutionNote,
          new_status: status,
          visible_to_user: true,
        });
        if (staffMessage && resolutionNote && staffMessage !== resolutionNote) {
          events.push({
            ticket_id: ticketId,
            actor_user_id: user.id,
            actor_email: user.email,
            event_type: 'staff_reply',
            message: staffMessage,
            new_status: status,
            visible_to_user: true,
          });
        }
        await admin.from('support_ticket_events').insert(events);

        const ticketUserId = String((ticket as { user_id?: string }).user_id || '');
        const notifyBody = staffMessage || resolutionNote;
        if (ticketUserId && notifyBody) {
          try {
            await admin.from('staff_notifications').insert({
              user_id: ticketUserId,
              category: 'support',
              title: 'Support ticket update',
              body: notifyBody.slice(0, 500),
              link_route: '/support',
              link_label: 'View support',
              dedupe_key: `support:${ticketId}:${nowIso}`,
              metadata: { ticketId, status },
              created_by_user_id: user.id,
            });
          } catch {
            // notifications table may not be installed yet
          }
        }

        return new Response(JSON.stringify({ ok: true, ticket }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'run_health') {
        const payload = await runHealthChecks(admin);
        const { data: saved, error: saveErr } = await admin
          .from('ops_health_snapshots')
          .insert({ captured_by_user_id: user.id, payload })
          .select('id, created_at')
          .single();
        return new Response(
          JSON.stringify({
            health: payload,
            saved: saveErr ? null : saved,
            saveError: saveErr?.message || null,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      return new Response(JSON.stringify({ error: 'Unknown action' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
