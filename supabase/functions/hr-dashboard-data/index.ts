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
  assessment: Record<string, unknown> | null;
  admin_data: { pipelineStage?: string; nextStep?: string; interviewScheduledAt?: string | null } | null;
};

function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
}

function toIsoDate(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function isClosedStage(stage: string): boolean {
  const s = stage.toLowerCase();
  return s === 'hired' || s.includes('not hired') || s.includes('withdrawn');
}

function defaultActionForStage(stage: string, readinessBand: string, riskCount: number): { action: string; priority: 'low' | 'medium' | 'high' | 'critical' } {
  if (riskCount > 0) return { action: 'Review risk and call candidate today', priority: 'high' };
  if (stage === 'Checked In') return { action: 'Invite to Live Career Overview Session', priority: 'medium' };
  if (stage === 'Invited to Live Career Overview Session') return { action: 'Follow up attendance confirmation', priority: 'high' };
  if (stage === 'Live Career Overview Session Attended') return { action: 'Send leadership assessment link', priority: 'high' };
  if (stage === 'Leadership assessment form sent') return { action: 'Reminder: complete assessment', priority: 'high' };
  if (stage === 'Leadership form submitted, awaiting evaluation') return { action: 'Complete evaluation and comments', priority: 'critical' };
  if (stage === 'Evaluation Done') return { action: 'Schedule interview', priority: readinessBand === 'Hot' ? 'critical' : 'high' };
  if (stage === 'Interview scheduled') return { action: 'Confirm interview attendance', priority: 'medium' };
  if (readinessBand === 'Hot') return { action: 'Fast-track next interview step', priority: 'high' };
  return { action: 'Review candidate profile', priority: 'medium' };
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
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(supabaseUrl, serviceRole);
    const hrAdmin = createClient(supabaseUrl, serviceRole, { db: { schema: 'hr_analytics' } });

    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const actorEmail = authData.user.email || null;

    if (req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as {
        action?: string;
        task_id?: number;
        risk_id?: number;
        candidate_id?: string;
        stage?: string;
        next_step?: string;
        task_type?: string;
        priority?: string;
        title?: string;
        details?: string;
      };

      if (body.action === 'resolve_task') {
        if (!body.task_id) return new Response(JSON.stringify({ error: 'Missing task_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        const now = new Date().toISOString();
        const { error: taskErr } = await hrAdmin.from('hr_tasks').update({ status: 'done', updated_at: now }).eq('id', body.task_id);
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
        if (!body.risk_id) return new Response(JSON.stringify({ error: 'Missing risk_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        const { error: riskErr } = await hrAdmin.from('hr_risk_flags').update({ status: 'resolved', resolved_at: new Date().toISOString() }).eq('id', body.risk_id);
        if (riskErr) throw riskErr;
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (body.action === 'set_candidate_stage') {
        if (!body.candidate_id || !body.stage) return new Response(JSON.stringify({ error: 'Missing candidate_id or stage' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        const { data: row, error: rowErr } = await admin.from('candidates').select('admin_data').eq('id', body.candidate_id).single();
        if (rowErr) throw rowErr;
        const nextAdmin = {
          ...((row?.admin_data && typeof row.admin_data === 'object') ? row.admin_data as Record<string, unknown> : {}),
          pipelineStage: body.stage,
        };
        const { error: upErr } = await admin.from('candidates').update({ admin_data: nextAdmin }).eq('id', body.candidate_id);
        if (upErr) throw upErr;
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (body.action === 'set_candidate_next_step') {
        if (!body.candidate_id) return new Response(JSON.stringify({ error: 'Missing candidate_id' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        const { data: row, error: rowErr } = await admin.from('candidates').select('admin_data').eq('id', body.candidate_id).single();
        if (rowErr) throw rowErr;
        const nextAdmin = {
          ...((row?.admin_data && typeof row.admin_data === 'object') ? row.admin_data as Record<string, unknown> : {}),
          nextStep: String(body.next_step || ''),
        };
        const { error: upErr } = await admin.from('candidates').update({ admin_data: nextAdmin }).eq('id', body.candidate_id);
        if (upErr) throw upErr;
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      if (body.action === 'create_task') {
        if (!body.candidate_id || !body.task_type) return new Response(JSON.stringify({ error: 'Missing candidate_id or task_type' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        const { data: inserted, error: insErr } = await hrAdmin
          .from('hr_tasks')
          .insert({
            candidate_id: body.candidate_id,
            task_type: body.task_type,
            priority: body.priority || 'medium',
            status: 'open',
            title: body.title || 'Manual recruiter task',
            details: body.details || null,
            owner_email: actorEmail,
            source: 'hr_dashboard_manual',
          })
          .select('id')
          .single();
        if (insErr) throw insErr;
        await hrAdmin.from('hr_task_events').insert({
          task_id: inserted.id,
          event_type: 'created',
          actor_email: actorEmail,
          payload: { source: 'hr-dashboard', action: 'create_task' },
        });
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
      liveSnapRaw,
    ] = await Promise.all([
      admin.from('candidates')
        .select('id,first_name,last_name,email,timestamp,status,score,fit_category,assessment,admin_data')
        .order('timestamp', { ascending: false })
        .limit(2000),
      hrAdmin.from('hr_candidate_signals').select('*'),
      hrAdmin.from('v_hr_latest_readiness').select('*'),
      hrAdmin.from('hr_risk_flags').select('*').eq('status', 'active').order('detected_at', { ascending: false }).limit(300),
      hrAdmin.from('v_hr_open_tasks').select('*').order('due_at', { ascending: true }).limit(500),
      hrAdmin.from('hr_funnel_daily').select('*').order('day', { ascending: false }).limit(60),
      hrAdmin.from('hr_broadcast_cohorts').select('*').order('cohort_date', { ascending: false }).limit(120),
      hrAdmin.from('hr_stage_sla').select('*').eq('enabled', true),
      admin.from('live_sessions_snapshots').select('generated_at,payload').order('generated_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (candidatesRaw.error) throw new Error(`candidates: ${candidatesRaw.error.message}`);

    const candidates = (candidatesRaw.data || []) as CandidateListRow[];
    const candidateMetaById = new Map(
      candidates.map((c) => [c.id, {
        candidate_name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
        candidate_date: c.timestamp || null,
      }]),
    );

    const signalsById = new Map((signalsRaw.data || []).map((r: Record<string, unknown>) => [String(r.candidate_id), r]));
    const scoresById = new Map((latestScoresRaw.data || []).map((r: Record<string, unknown>) => [String(r.candidate_id), r]));
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
      const signal = signalsById.get(c.id) as Record<string, unknown> | undefined;
      const latestScore = scoresById.get(c.id) as Record<string, unknown> | undefined;
      const stage = String(c.admin_data?.pipelineStage || signal?.pipeline_stage || 'Checked In');
      const stageAt = String(signal?.latest_stage_change_at || c.timestamp || '');
      const elapsed = minutesSince(stageAt);
      const sla = slaByStage.get(stage) ?? null;
      const overdue = elapsed != null && sla != null ? Math.max(0, elapsed - sla) : 0;
      return {
        candidate_id: c.id,
        candidate_name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
        candidate_date: c.timestamp || null,
        email: c.email,
        pipeline_stage: stage,
        status: c.status,
        readiness_score: Number(latestScore?.score ?? 0),
        readiness_band: String(latestScore?.band ?? 'Monitor'),
        active_risk_count: riskCountById.get(c.id) || 0,
        overdue_minutes: overdue,
        is_overdue: overdue > 0,
        next_step: c.admin_data?.nextStep || (signal?.next_step as string | null) || null,
        assessment_completed: c.status === 'assessment_complete' || !!c.assessment,
        interview_scheduled_at: toIsoDate(c.admin_data?.interviewScheduledAt),
      };
    });

    const now = Date.now();
    const inPipeline = joinedCandidates.filter((c) => !isClosedStage(String(c.pipeline_stage)));
    const newLast7d = joinedCandidates.filter((c) => {
      const t = Date.parse(String(c.candidate_date || ''));
      return Number.isFinite(t) && (now - t) <= 7 * 86400_000;
    }).length;
    const assessmentCompleted = joinedCandidates.filter((c) => Boolean(c.assessment_completed)).length;
    const interviewScheduled = joinedCandidates.filter((c) => Boolean(c.interview_scheduled_at) || String(c.pipeline_stage) === 'Interview scheduled').length;
    const hiredCount = joinedCandidates.filter((c) => String(c.pipeline_stage) === 'Hired').length;
    const readinessCovered = joinedCandidates.filter((c) => Number(c.readiness_score || 0) > 0).length;
    const avgReadiness = joinedCandidates.length > 0
      ? Math.round(joinedCandidates.reduce((s, c) => s + Number(c.readiness_score || 0), 0) / joinedCandidates.length)
      : 0;

    const stageBreakdown = Array.from(
      joinedCandidates.reduce((acc, c) => {
        const key = String(c.pipeline_stage || 'Unknown');
        acc.set(key, (acc.get(key) || 0) + 1);
        return acc;
      }, new Map<string, number>())
    ).map(([stage, count]) => ({ stage, count })).sort((a, b) => b.count - a.count);

    const livePayload = (liveSnapRaw.data?.payload || {}) as Record<string, unknown>;
    const livePast = Array.isArray(livePayload.past_meetings) ? livePayload.past_meetings as Array<Record<string, unknown>> : [];
    const liveInvited = livePast.reduce((s, r) => s + Number((r.stats as Record<string, unknown> | undefined)?.invited_count || 0), 0);
    const liveAttended = livePast.reduce((s, r) => s + Number((r.stats as Record<string, unknown> | undefined)?.attended_matched_count || 0), 0);
    const liveMetrics = {
      sessions_count: livePast.length,
      invited_total: liveInvited,
      attended_total: liveAttended,
      attendance_rate_pct: liveInvited > 0 ? Math.round((liveAttended / liveInvited) * 100) : 0,
      latest_generated_at: liveSnapRaw.data?.generated_at || null,
    };

    const cohortRows = (cohortsRaw.data || []) as Array<Record<string, unknown>>;
    const webinar30 = cohortRows.filter((r) => {
      const d = Date.parse(String(r.cohort_date || ''));
      return Number.isFinite(d) && (now - d) <= 30 * 86400_000;
    });
    const webinarMetrics = {
      cohorts_30d: webinar30.length,
      invited_30d: webinar30.reduce((s, r) => s + Number(r.invited_count || 0), 0),
      watched_30d: webinar30.reduce((s, r) => s + Number(r.watched_count || 0), 0),
      watched_live_30d: webinar30.reduce((s, r) => s + Number(r.watched_live_count || 0), 0),
      watched_replay_30d: webinar30.reduce((s, r) => s + Number(r.watched_replay_count || 0), 0),
    };

    const actionQueue = joinedCandidates
      .map((c) => {
        const decision = defaultActionForStage(String(c.pipeline_stage || ''), String(c.readiness_band || 'Monitor'), Number(c.active_risk_count || 0));
        return { ...c, recommended_action: decision.action, priority: decision.priority };
      })
      .filter((c) => !isClosedStage(String(c.pipeline_stage)))
      .sort((a, b) => {
        const rank = (p: string) => (p === 'critical' ? 4 : p === 'high' ? 3 : p === 'medium' ? 2 : 1);
        const prioritySort = rank(String(b.priority)) - rank(String(a.priority));
        if (prioritySort !== 0) return prioritySort;
        return Number(b.overdue_minutes || 0) - Number(a.overdue_minutes || 0);
      })
      .slice(0, 120);

    const openTasks = (openTasksRaw.data || []).map((row: Record<string, unknown>) => {
      const candidateId = String(row.candidate_id || '');
      const meta = candidateMetaById.get(candidateId);
      return { ...row, candidate_name: meta?.candidate_name || candidateId, candidate_date: meta?.candidate_date || null };
    });
    const activeRisks = (activeRisksRaw.data || []).map((row: Record<string, unknown>) => {
      const candidateId = String(row.candidate_id || '');
      const meta = candidateMetaById.get(candidateId);
      return { ...row, candidate_name: meta?.candidate_name || candidateId, candidate_date: meta?.candidate_date || null };
    });

    const summary = {
      total_candidates: joinedCandidates.length,
      in_pipeline: inPipeline.length,
      new_last_7d: newLast7d,
      hot_candidates: joinedCandidates.filter((c) => c.readiness_band === 'Hot').length,
      warm_candidates: joinedCandidates.filter((c) => c.readiness_band === 'Warm').length,
      monitor_candidates: joinedCandidates.filter((c) => c.readiness_band === 'Monitor').length,
      overdue_candidates: joinedCandidates.filter((c) => c.is_overdue).length,
      open_tasks: (openTasksRaw.data || []).length,
      active_risks: (activeRisksRaw.data || []).length,
      assessment_completed: assessmentCompleted,
      interview_scheduled: interviewScheduled,
      hired_count: hiredCount,
      readiness_coverage: readinessCovered,
      avg_readiness_score: avgReadiness,
    };

    return new Response(
      JSON.stringify({
        ok: true,
        generated_at: new Date().toISOString(),
        summary,
        stage_breakdown: stageBreakdown,
        action_queue: actionQueue,
        live_metrics: liveMetrics,
        webinar_metrics: webinarMetrics,
        candidates: joinedCandidates,
        open_tasks: openTasks,
        active_risks: activeRisks,
        funnel_daily: funnelRaw.data || [],
        cohorts: cohortsRaw.data || [],
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
