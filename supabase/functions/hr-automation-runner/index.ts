import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

function normalizeErr(e: unknown): string {
  if (typeof e === 'string') return e || 'Unknown error';
  if (e instanceof Error) return e.message || e.name || 'Unknown error';
  if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>;
    const msg = obj.message;
    if (typeof msg === 'string' && msg.trim()) return msg;
    const details = obj.details;
    if (typeof details === 'string' && details.trim()) return details;
    try {
      const text = JSON.stringify(obj);
      if (text && text !== '{}' && text !== '[]') return text;
    } catch {
      // ignore stringify failures
    }
  }
  return String(e || 'Unknown error');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const hrAdmin  = createClient(supabaseUrl, serviceRole, { db: { schema: 'hr_analytics' } });

    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean };
    const dryRun = body.dry_run !== false;
    const allowWrites = (Deno.env.get('HR_AUTOMATION_ENABLED')?.trim() || '').toLowerCase() === 'true';
    const writesEnabled = !dryRun && allowWrites;

    const warnings: string[] = [];
    const { data: candidates, error: candErr } = await hrAdmin
      .from('v_hr_latest_readiness')
      .select('candidate_id,score,band')
      .order('score', { ascending: false })
      .limit(300);
    if (candErr) {
      warnings.push(`v_hr_latest_readiness unavailable: ${normalizeErr(candErr)}`);
    }

    const recommendations: Array<Record<string, unknown>> = [];
    for (const row of candidates || []) {
      const score = Number(row.score || 0);
      if (score >= 80) {
        recommendations.push({
          candidate_id: row.candidate_id,
          action: 'schedule_interview',
          reason: `Readiness score ${score} (Hot)`,
          priority: score >= 90 ? 'critical' : 'high',
        });
      } else if (score < 45) {
        recommendations.push({
          candidate_id: row.candidate_id,
          action: 'send_reminder',
          reason: `Readiness score ${score} (Monitor)`,
          priority: 'medium',
        });
      }
    }

    let createdTasks = 0;
    if (writesEnabled && recommendations.length > 0) {
      const taskRows = recommendations.map((r) => ({
        candidate_id: r.candidate_id,
        task_type: r.action === 'schedule_interview' ? 'schedule_interview' : 'send_reminder',
        priority: r.priority,
        status: 'open',
        title: `Automation recommendation: ${r.action}`,
        details: String(r.reason),
        source: 'automation_beta',
        metadata: { recommendation: r },
      }));
      const { data: inserted, error: taskErr } = await hrAdmin.from('hr_tasks').insert(taskRows).select('id');
      if (taskErr) warnings.push(`hr_tasks insert failed: ${normalizeErr(taskErr)}`);
      createdTasks = inserted?.length || 0;
      if (inserted && inserted.length > 0) {
        const { error: evtErr } = await hrAdmin.from('hr_task_events').insert(
          inserted.map((t: Record<string, unknown>) => ({
            task_id: t.id,
            event_type: 'created',
            actor_email: authData.user?.email || null,
            payload: { source: 'hr-automation-runner' },
          })),
        );
        if (evtErr) warnings.push(`hr_task_events insert failed: ${normalizeErr(evtErr)}`);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        dry_run: dryRun,
        writes_enabled: writesEnabled,
        recommendations: recommendations.slice(0, 100),
        recommendation_count: recommendations.length,
        tasks_created: createdTasks,
        warnings,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: normalizeErr(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

