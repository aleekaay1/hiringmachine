import { createClient } from 'npm:@supabase/supabase-js@2';
import { computeReadiness } from '../_shared/hrScoring.ts';
import { detectRisks } from '../_shared/hrRiskRules.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

type CandidateRow = {
  id: string;
  email: string;
  timestamp: string;
  score: number | null;
  fit_category: string | null;
  status: string;
  admin_data: {
    pipelineStage?: string;
    rating?: number | null;
    tags?: string[];
    interviewScheduledAt?: string | null;
    nextStep?: string;
  } | null;
};

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v ?? '').trim()).filter(Boolean);
}

function normEmail(s: string | null | undefined): string {
  return String(s || '').trim().toLowerCase();
}

function toIsoMaybe(input: unknown): string | null {
  const s = String(input || '').trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 60000));
}

async function deriveLiveSignals(admin: ReturnType<typeof createClient>) {
  const invited = new Set<string>();
  const attended = new Set<string>();
  const { data } = await admin
    .from('live_sessions_snapshots')
    .select('payload')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const payload = (data?.payload || {}) as Record<string, unknown>;
  const upcoming = Array.isArray(payload.upcoming_meetings) ? payload.upcoming_meetings as Array<Record<string, unknown>> : [];
  const past = Array.isArray(payload.past_meetings) ? payload.past_meetings as Array<Record<string, unknown>> : [];

  for (const m of upcoming) {
    const inv = Array.isArray(m.invitees) ? m.invitees as Array<Record<string, unknown>> : [];
    for (const i of inv) {
      const e = normEmail(String(i.email || ''));
      if (e) invited.add(e);
    }
  }
  for (const m of past) {
    const inv = Array.isArray(m.invitees) ? m.invitees as Array<Record<string, unknown>> : [];
    for (const i of inv) {
      const e = normEmail(String(i.email || ''));
      if (!e) continue;
      invited.add(e);
      if (i.attended_zoom === true) attended.add(e);
    }
  }
  return { invited, attended };
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
    const admin   = createClient(supabaseUrl, serviceRole);
    const hrAdmin = createClient(supabaseUrl, serviceRole, { db: { schema: 'hr_analytics' } });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = (await req.json().catch(() => ({}))) as { dry_run?: boolean };
    const dryRun = body.dry_run !== false;

    const { data: candidatesRaw, error: candErr } = await admin
      .from('candidates')
      .select('id,email,timestamp,score,fit_category,status,admin_data');
    if (candErr) throw candErr;
    const candidates = (candidatesRaw || []) as CandidateRow[];

    const { data: slaRaw } = await hrAdmin.from('hr_stage_sla').select('stage,sla_minutes,enabled');
    const slaByStage = new Map<string, number>();
    for (const row of slaRaw || []) {
      if (row.enabled === false) continue;
      slaByStage.set(String(row.stage), Number(row.sla_minutes));
    }

    const live = await deriveLiveSignals(admin);
    const signalRows: Array<Record<string, unknown>> = [];
    const scoreRows: Array<Record<string, unknown>> = [];
    const riskRows: Array<Record<string, unknown>> = [];
    const stageEvents: Array<Record<string, unknown>> = [];
    const taskRows: Array<Record<string, unknown>> = [];

    for (const c of candidates) {
      const stage = String(c.admin_data?.pipelineStage || 'Checked In');
      const email = normEmail(c.email);
      const invitedLiveSession = live.invited.has(email);
      const attendedLiveSession = live.attended.has(email);
      const hasAssessment = c.status === 'assessment_complete';
      const tags = toTextArray(c.admin_data?.tags);
      const rating = toNumberOrNull(c.admin_data?.rating);

      const readiness = computeReadiness({
        score: c.score,
        fitCategory: c.fit_category,
        stage,
        rating,
        tagsCount: tags.length,
        invitedLiveSession,
        attendedLiveSession,
        webinarInvitedCount: invitedLiveSession ? 1 : 0,
        webinarWatchedCount: attendedLiveSession ? 1 : 0,
        webinarWatchedLiveCount: attendedLiveSession ? 1 : 0,
        webinarWatchedReplayCount: 0,
        hasAssessment,
      });

      const stageChangedAt = toIsoMaybe(c.admin_data?.interviewScheduledAt) || toIsoMaybe(c.timestamp);
      const overdueMinutes = (() => {
        const sla = slaByStage.get(stage);
        if (!sla) return null;
        const since = minutesSince(stageChangedAt);
        if (since == null) return null;
        return since > sla ? since - sla : 0;
      })();

      signalRows.push({
        candidate_id: c.id,
        pipeline_stage: stage,
        score: c.score,
        fit_category: c.fit_category,
        invited_live_session: invitedLiveSession,
        attended_live_session: attendedLiveSession,
        webinar_invited_count: invitedLiveSession ? 1 : 0,
        webinar_watched_count: attendedLiveSession ? 1 : 0,
        webinar_watched_live_count: attendedLiveSession ? 1 : 0,
        webinar_watched_replay_count: 0,
        first_check_in_at: toIsoMaybe(c.timestamp),
        latest_stage_change_at: stageChangedAt,
        assessment_submitted_at: hasAssessment ? toIsoMaybe(c.timestamp) : null,
        interview_scheduled_at: toIsoMaybe(c.admin_data?.interviewScheduledAt),
        rating,
        tags,
        next_step: c.admin_data?.nextStep || null,
        updated_at: new Date().toISOString(),
      });

      scoreRows.push({
        candidate_id: c.id,
        score: readiness.score,
        band: readiness.band,
        component_scores: readiness.componentScores,
        why: readiness.why,
        model_version: 'v1',
      });

      const risks = detectRisks({
        stage,
        hasAssessment,
        invitedLiveSession,
        attendedLiveSession,
        webinarInvitedCount: invitedLiveSession ? 1 : 0,
        webinarWatchedCount: attendedLiveSession ? 1 : 0,
        readinessScore: readiness.score,
        fitCategory: c.fit_category,
      });
      for (const r of risks) {
        riskRows.push({
          candidate_id: c.id,
          risk_type: r.risk_type,
          status: 'active',
          confidence: r.confidence,
          reason: r.reason,
          metadata: r.metadata,
        });
      }

      stageEvents.push({
        candidate_id: c.id,
        stage,
        event_at: stageChangedAt || new Date().toISOString(),
        source: 'hr-rollup-jobs',
        metadata: { overdue_minutes: overdueMinutes },
      });

      if ((overdueMinutes ?? 0) > 0) {
        taskRows.push({
          candidate_id: c.id,
          task_type: 'call_now',
          priority: overdueMinutes && overdueMinutes > 720 ? 'critical' : 'high',
          status: 'open',
          title: 'SLA overdue follow-up',
          details: `Candidate is overdue in stage "${stage}" by ${overdueMinutes} minutes.`,
          due_at: new Date().toISOString(),
          source: 'sla_queue',
          metadata: { stage, overdue_minutes: overdueMinutes },
        });
      } else if (readiness.band === 'Hot' && stage !== 'Interview scheduled' && stage !== 'Hired') {
        taskRows.push({
          candidate_id: c.id,
          task_type: 'schedule_interview',
          priority: 'high',
          status: 'open',
          title: 'Fast-track interview scheduling',
          details: 'Candidate is Hot based on readiness model.',
          due_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
          source: 'readiness_queue',
          metadata: { readiness_score: readiness.score },
        });
      }
    }

    const result: Record<string, unknown> = {
      ok: true,
      dry_run: dryRun,
      candidates_scanned: candidates.length,
      signal_rows: signalRows.length,
      score_rows: scoreRows.length,
      risk_rows: riskRows.length,
      stage_event_rows: stageEvents.length,
      proposed_task_rows: taskRows.length,
    };

    if (!dryRun) {
      if (signalRows.length > 0) {
        const { error } = await hrAdmin.from('hr_candidate_signals').upsert(signalRows, { onConflict: 'candidate_id' });
        if (error) throw new Error(`hr_candidate_signals upsert failed: ${error.message}`);
      }
      if (scoreRows.length > 0) {
        const { error } = await hrAdmin.from('hr_readiness_scores').insert(scoreRows);
        if (error) throw new Error(`hr_readiness_scores insert failed: ${error.message}`);
      }
      if (riskRows.length > 0) {
        const { error: resolveErr } = await hrAdmin
          .from('hr_risk_flags')
          .update({ status: 'resolved', resolved_at: new Date().toISOString() })
          .eq('status', 'active');
        if (resolveErr) throw new Error(`hr_risk_flags resolve failed: ${resolveErr.message}`);
        const { error: riskInsErr } = await hrAdmin.from('hr_risk_flags').insert(riskRows);
        if (riskInsErr) throw new Error(`hr_risk_flags insert failed: ${riskInsErr.message}`);
      }
      if (stageEvents.length > 0) {
        const { error } = await hrAdmin.from('hr_stage_events').insert(stageEvents);
        if (error) throw new Error(`hr_stage_events insert failed: ${error.message}`);
      }

      if (taskRows.length > 0) {
        const { data: existingOpen } = await hrAdmin
          .from('hr_tasks')
          .select('candidate_id,task_type,status')
          .in('status', ['open', 'in_progress']);
        const openSet = new Set((existingOpen || []).map((r: Record<string, unknown>) => `${r.candidate_id}|${r.task_type}`));
        const deduped = taskRows.filter((t) => !openSet.has(`${t.candidate_id}|${t.task_type}`));
        if (deduped.length > 0) {
          const { data: inserted, error: taskErr } = await hrAdmin.from('hr_tasks').insert(deduped).select('id');
          if (taskErr) throw new Error(`hr_tasks insert failed: ${taskErr.message}`);
          if (inserted && inserted.length > 0) {
            const events = inserted.map((r: Record<string, unknown>) => ({
              task_id: r.id,
              event_type: 'created',
              actor_email: userData.user?.email || null,
              payload: { source: 'hr-rollup-jobs' },
            }));
            const { error: evtErr } = await hrAdmin.from('hr_task_events').insert(events);
            if (evtErr) throw new Error(`hr_task_events insert failed: ${evtErr.message}`);
          }
          result.tasks_created = deduped.length;
        } else {
          result.tasks_created = 0;
        }
      } else {
        result.tasks_created = 0;
      }

      // Refresh materialized view via raw SQL through the service-role client
      await admin.rpc('refresh_materialized_view_hr_funnel_daily').catch(() => { /* view refresh optional */ });
    }

    return new Response(JSON.stringify(result), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

