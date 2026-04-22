import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

type CandidateListRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  timestamp: string;
  status: string;
  score: number | null;
  fit_category: string | null;
  admin_data: { pipelineStage?: string; nextStep?: string } | null;
};

function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey    = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin    = createClient(supabaseUrl, serviceRole);
    // Scoped client for hr_analytics schema
    const hrAdmin  = createClient(supabaseUrl, serviceRole, { db: { schema: 'hr_analytics' } });

    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as {
        action?: string;
        task_id?: number;
        risk_id?: number;
      };
      const actorEmail = authData.user.email || null;

      if (body.action === 'resolve_task') {
        if (!body.task_id) {
          return new Response(JSON.stringify({ error: 'Missing task_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const now = new Date().toISOString();
        const { error: taskErr } = await hrAdmin
          .from('hr_tasks')
          .update({ status: 'done', updated_at: now })
          .eq('id', body.task_id);
        if (taskErr) throw taskErr;
        await hrAdmin.from('hr_task_events').insert({
          task_id: body.task_id,
          event_type: 'completed',
          actor_email: actorEmail,
          payload: { source: 'hr-dashboard', action: 'resolve_task' },
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (body.action === 'resolve_risk') {
        if (!body.risk_id) {
          return new Response(JSON.stringify({ error: 'Missing risk_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        const { error: riskErr } = await hrAdmin
          .from('hr_risk_flags')
          .update({ status: 'resolved', resolved_at: new Date().toISOString() })
          .eq('id', body.risk_id);
        if (riskErr) throw riskErr;
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ error: 'Unsupported action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const [
      candidatesRaw,
      signalsRaw,
      latestScoresRaw,
      activeRisksRaw,
      openTasksRaw,
      funnelRaw,
      cohortsRaw,
      stageSlaRaw,
    ] = await Promise.all([
      admin.from('candidates')
        .select('id,first_name,last_name,email,timestamp,status,score,fit_category,admin_data')
        .order('timestamp', { ascending: false })
        .limit(500),
      hrAdmin.from('hr_candidate_signals').select('*'),
      hrAdmin.from('v_hr_latest_readiness').select('*'),
      hrAdmin.from('hr_risk_flags').select('*').eq('status', 'active').order('detected_at', { ascending: false }).limit(200),
      hrAdmin.from('v_hr_open_tasks').select('*').order('due_at', { ascending: true }).limit(300),
      hrAdmin.from('hr_funnel_daily').select('*').order('day', { ascending: false }).limit(60),
      hrAdmin.from('hr_broadcast_cohorts').select('*').order('cohort_date', { ascending: false }).limit(60),
      hrAdmin.from('hr_stage_sla').select('*').eq('enabled', true),
    ]);

    // Graceful: report first real error, skip missing HR tables (schema may need warmup)
    if (candidatesRaw.error) throw new Error(`candidates: ${candidatesRaw.error.message}`);

    const candidates = (candidatesRaw.data || []) as CandidateListRow[];
    const candidateMetaById = new Map(
      candidates.map((c) => [
        c.id,
        {
          candidate_name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
          candidate_date: c.timestamp || null,
          email: c.email || null,
        },
      ]),
    );

    const signalsById = new Map(
      (signalsRaw.data || []).map((r: Record<string, unknown>) => [String(r.candidate_id), r]),
    );
    const scoresById = new Map(
      (latestScoresRaw.data || []).map((r: Record<string, unknown>) => [String(r.candidate_id), r]),
    );
    const riskCountById = new Map<string, number>();
    for (const r of activeRisksRaw.data || []) {
      const id = String((r as Record<string, unknown>).candidate_id);
      riskCountById.set(id, (riskCountById.get(id) || 0) + 1);
    }
    const slaByStage = new Map<string, number>();
    for (const s of stageSlaRaw.data || []) {
      slaByStage.set(String((s as Record<string, unknown>).stage), Number((s as Record<string, unknown>).sla_minutes));
    }

    const joinedCandidates = candidates.map((c) => {
      const signal     = signalsById.get(c.id) as Record<string, unknown> | undefined;
      const latestScore = scoresById.get(c.id) as Record<string, unknown> | undefined;
      const stage      = String(c.admin_data?.pipelineStage || signal?.pipeline_stage || 'Checked In');
      const stageAt    = String(signal?.latest_stage_change_at || c.timestamp || '');
      const elapsed    = minutesSince(stageAt);
      const sla        = slaByStage.get(stage) ?? null;
      const overdue    = elapsed != null && sla != null ? Math.max(0, elapsed - sla) : 0;
      return {
        candidate_id:   c.id,
        candidate_name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
        candidate_date: c.timestamp || null,
        email:          c.email,
        pipeline_stage: stage,
        status:         c.status,
        readiness_score: Number(latestScore?.score ?? 0),
        readiness_band:  String(latestScore?.band ?? 'Monitor'),
        active_risk_count: riskCountById.get(c.id) || 0,
        overdue_minutes: overdue,
        is_overdue:     overdue > 0,
        next_step:      c.admin_data?.nextStep || (signal?.next_step as string | null) || null,
      };
    });

    const openTasks = (openTasksRaw.data || []).map((row: Record<string, unknown>) => {
      const candidateId = String(row.candidate_id || '');
      const meta = candidateMetaById.get(candidateId);
      return {
        ...row,
        candidate_name: meta?.candidate_name || candidateId,
        candidate_date: meta?.candidate_date || null,
      };
    });

    const activeRisks = (activeRisksRaw.data || []).map((row: Record<string, unknown>) => {
      const candidateId = String(row.candidate_id || '');
      const meta = candidateMetaById.get(candidateId);
      return {
        ...row,
        candidate_name: meta?.candidate_name || candidateId,
        candidate_date: meta?.candidate_date || null,
      };
    });

    const summary = {
      total_candidates:  joinedCandidates.length,
      hot_candidates:    joinedCandidates.filter((c) => c.readiness_band === 'Hot').length,
      overdue_candidates: joinedCandidates.filter((c) => c.is_overdue).length,
      open_tasks:        (openTasksRaw.data || []).length,
      active_risks:      (activeRisksRaw.data || []).length,
    };

    return new Response(
      JSON.stringify({
        ok: true,
        generated_at: new Date().toISOString(),
        summary,
        candidates: joinedCandidates,
        open_tasks: openTasks,
        active_risks: activeRisks,
        funnel_daily: funnelRaw.data    || [],
        cohorts:      cohortsRaw.data   || [],
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('hr-dashboard-data', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
