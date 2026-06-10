import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const HR_DISTRIBUTOR_EMAILS = new Set([
  'ali@globelife-paz.com',
  'hr.licensing@globelife-paz.com',
]);

type ImportRow = {
  row_number?: number;
  lead_age?: string | null;
  full_name?: string;
  email?: string | null;
  phone?: string | null;
};

function normalizeEmail(value: string | null | undefined): string | null {
  const v = String(value || '').trim().toLowerCase();
  return v || null;
}

function normalizePhone(value: string | null | undefined): string | null {
  const v = String(value || '').trim();
  return v || null;
}

function filenameTokens(filename: string): string[] {
  return String(filename || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function inferLeadTeamFromFilename(filename: string): string | null {
  const tokens = filenameTokens(filename);
  if (tokens.includes('rms')) return 'RMS';
  if (tokens.includes('cooper')) return 'Cooper';
  return null;
}

function normalizeLeadTeam(value: string | null | undefined): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'rms') return 'RMS';
  if (lower === 'cooper') return 'Cooper';
  return trimmed;
}

type CallRecordRow = {
  candidate_id: string;
  disposition: string | null;
  disposed_at: string | null;
};

function emptyDispositionCounts(): Record<string, number> {
  return {
    booked: 0,
    no_answer: 0,
    voicemail_left: 0,
    callback_requested: 0,
    not_interested: 0,
    busy: 0,
    wrong_number: 0,
    connected: 0,
    other: 0,
  };
}

function incrementDispositionCount(counts: Record<string, number>, disposition: string | null) {
  const d = String(disposition || '').trim().toLowerCase();
  if (!d) return;
  if (d === 'booked') counts.booked += 1;
  else if (d === 'no answer') counts.no_answer += 1;
  else if (d === 'voicemail left') counts.voicemail_left += 1;
  else if (d === 'callback requested') counts.callback_requested += 1;
  else if (d === 'not interested' || d === 'do not call') counts.not_interested += 1;
  else if (d === 'busy / line busy') counts.busy += 1;
  else if (d === 'wrong number') counts.wrong_number += 1;
  else if (d === 'connected' || d === 'interested – next step' || d === 'scheduled interview') counts.connected += 1;
  else counts.other += 1;
}

const PIPELINE_BUCKET = 'pipeline-resumes';

async function listBatchesWithPoolCounts(
  admin: ReturnType<typeof createClient>,
  limit = 30,
) {
  const { data: batches, error } = await admin
    .from('pipeline_lead_batches')
    .select('id, label, created_at, source_filename, created_by_label, lead_team, total_rows, imported_count, assigned_count, skipped_duplicate_count, failed_count')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (batches || []) as Array<{ id: string }>;
  const poolCounts = new Map<string, number>();
  const batchIds = rows.map((row) => row.id);
  if (batchIds.length) {
    for (let offset = 0; offset < batchIds.length; offset += 100) {
      const chunk = batchIds.slice(offset, offset + 100);
      const { data: poolRows, error: poolErr } = await admin
        .from('pipeline_candidates')
        .select('lead_batch_id')
        .eq('source', 'hr_csv_batch')
        .is('assigned_to_user_id', null)
        .in('lead_batch_id', chunk);
      if (poolErr) throw poolErr;
      for (const row of poolRows || []) {
        const batchId = String((row as { lead_batch_id?: string | null }).lead_batch_id || '');
        if (!batchId) continue;
        poolCounts.set(batchId, (poolCounts.get(batchId) || 0) + 1);
      }
    }
  }
  return rows.map((batch) => ({
    ...(batch as Record<string, unknown>),
    pool_count: poolCounts.get(batch.id) || 0,
  }));
}

async function retractHrAssignments(
  admin: ReturnType<typeof createClient>,
  candidateIds: string[],
): Promise<{ retracted_ids: string[]; errors: Array<{ id: string; error: string }> }> {
  const retractedIds: string[] = [];
  const errors: Array<{ id: string; error: string }> = [];
  const batchDecrements = new Map<string, number>();

  for (const candidateId of [...new Set(candidateIds.map((id) => String(id).trim()).filter(Boolean))]) {
    const { data: row, error: getErr } = await admin
      .from('pipeline_candidates')
      .select('id, source, assigned_to_user_id, lead_batch_id, metadata')
      .eq('id', candidateId)
      .maybeSingle();
    if (getErr || !row) {
      errors.push({ id: candidateId, error: 'Lead not found.' });
      continue;
    }
    const candidate = row as Record<string, unknown>;
    if (String(candidate.source || '') !== 'hr_csv_batch') {
      errors.push({ id: candidateId, error: 'Not an HR import lead.' });
      continue;
    }
    if (!candidate.assigned_to_user_id) {
      errors.push({ id: candidateId, error: 'Lead is not assigned to a recruiter.' });
      continue;
    }

    const existingMeta =
      candidate.metadata && typeof candidate.metadata === 'object'
        ? (candidate.metadata as Record<string, unknown>)
        : {};
    const { error: upErr } = await admin
      .from('pipeline_candidates')
      .update({
        uploader_user_id: null,
        uploader_label: null,
        assigned_to_user_id: null,
        assigned_to_label: null,
        assigned_at: null,
        assigned_by_user_id: null,
        status: 'open',
        journey_stage: 'new',
        metadata: {
          ...existingMeta,
          retracted_at: new Date().toISOString(),
        },
      })
      .eq('id', candidateId);

    if (upErr) {
      errors.push({ id: candidateId, error: upErr.message });
      continue;
    }

    retractedIds.push(candidateId);
    const batchId = String(candidate.lead_batch_id || '');
    if (batchId) batchDecrements.set(batchId, (batchDecrements.get(batchId) || 0) + 1);
  }

  for (const [batchId, count] of batchDecrements.entries()) {
    const { data: batch } = await admin
      .from('pipeline_lead_batches')
      .select('assigned_count')
      .eq('id', batchId)
      .maybeSingle();
    const nextAssigned = Math.max(0, Number((batch as { assigned_count?: number } | null)?.assigned_count || 0) - count);
    await admin.from('pipeline_lead_batches').update({ assigned_count: nextAssigned }).eq('id', batchId);
  }

  return { retracted_ids: retractedIds, errors };
}

async function deleteHrPoolCandidates(
  admin: ReturnType<typeof createClient>,
  candidateIds: string[],
): Promise<{ deleted_ids: string[]; errors: Array<{ id: string; error: string }> }> {
  const deletedIds: string[] = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (const candidateId of [...new Set(candidateIds.map((id) => String(id).trim()).filter(Boolean))]) {
    const { data: row, error: getErr } = await admin
      .from('pipeline_candidates')
      .select('id, source, assigned_to_user_id, lead_batch_id')
      .eq('id', candidateId)
      .maybeSingle();
    if (getErr || !row) {
      errors.push({ id: candidateId, error: 'Lead not found.' });
      continue;
    }
    const candidate = row as Record<string, unknown>;
    if (String(candidate.source || '') !== 'hr_csv_batch') {
      errors.push({ id: candidateId, error: 'Not an HR import lead.' });
      continue;
    }
    if (candidate.assigned_to_user_id) {
      errors.push({ id: candidateId, error: 'Already assigned to a recruiter.' });
      continue;
    }

    const { data: resumes, error: resumeErr } = await admin
      .from('pipeline_resumes')
      .select('storage_bucket, storage_path')
      .eq('candidate_id', candidateId);
    if (resumeErr) {
      errors.push({ id: candidateId, error: resumeErr.message });
      continue;
    }

    const grouped = new Map<string, string[]>();
    for (const resume of resumes || []) {
      const bucket = String((resume as { storage_bucket?: string }).storage_bucket || PIPELINE_BUCKET);
      const path = String((resume as { storage_path?: string }).storage_path || '');
      if (!path) continue;
      if (!grouped.has(bucket)) grouped.set(bucket, []);
      grouped.get(bucket)!.push(path);
    }
    for (const [bucket, paths] of grouped.entries()) {
      if (paths.length) await admin.storage.from(bucket).remove(paths);
    }

    const { error: delErr } = await admin.from('pipeline_candidates').delete().eq('id', candidateId);
    if (delErr) {
      errors.push({ id: candidateId, error: delErr.message });
      continue;
    }
    deletedIds.push(candidateId);
  }

  return { deleted_ids: deletedIds, errors };
}

async function cleanupBatchIfEmpty(admin: ReturnType<typeof createClient>, batchId: string): Promise<boolean> {
  const { count, error } = await admin
    .from('pipeline_candidates')
    .select('id', { count: 'exact', head: true })
    .eq('lead_batch_id', batchId);
  if (error) throw error;
  if ((count ?? 0) > 0) return false;
  const { error: delErr } = await admin.from('pipeline_lead_batches').delete().eq('id', batchId);
  if (delErr) throw delErr;
  return true;
}

async function fetchDispositionMaps(
  admin: ReturnType<typeof createClient>,
  candidateIds: string[],
): Promise<{ latest: Map<string, CallRecordRow>; counts: Map<string, number> }> {
  const latest = new Map<string, CallRecordRow>();
  const counts = new Map<string, number>();
  if (!candidateIds.length) return { latest, counts };

  for (let offset = 0; offset < candidateIds.length; offset += 150) {
    const chunk = candidateIds.slice(offset, offset + 150);
    const { data, error } = await admin
      .from('pipeline_call_records')
      .select('candidate_id, disposition, disposed_at')
      .in('candidate_id', chunk)
      .order('disposed_at', { ascending: false });
    if (error) throw error;
    for (const row of (data || []) as CallRecordRow[]) {
      counts.set(row.candidate_id, (counts.get(row.candidate_id) || 0) + 1);
      if (!latest.has(row.candidate_id)) latest.set(row.candidate_id, row);
    }
  }
  return { latest, counts };
}

async function assertHrDistributor(
  authClient: ReturnType<typeof createClient>,
  user: { id: string; email?: string | null },
): Promise<void> {
  const email = String(user.email || '').trim().toLowerCase();
  if (HR_DISTRIBUTOR_EMAILS.has(email)) return;
  const { data: profile } = await authClient
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (String(profile?.role || '') === 'hr') return;
  throw new Error('You do not have access to HR lead distribution.');
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
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
    if (!serviceRole) {
      return new Response(JSON.stringify({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await authClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await assertHrDistributor(authClient, user);
    const admin = createClient(supabaseUrl, serviceRole);
    const url = new URL(req.url);
    const mode = (url.searchParams.get('mode') || '').trim();

    const actorLabel =
      String((await authClient.from('user_profiles').select('full_name').eq('user_id', user.id).maybeSingle()).data?.full_name || '').trim()
      || String(user.email || '').trim()
      || user.id;

    if (req.method === 'GET' && mode === 'batches') {
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 30)));
      const batches = await listBatchesWithPoolCounts(admin, limit);
      return new Response(JSON.stringify({ ok: true, batches }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && mode === 'pool') {
      const batchId = url.searchParams.get('batch_id')?.trim() || '';
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 200)));
      let query = admin
        .from('pipeline_candidates')
        .select('id, full_name, email, phone, lead_batch_id, created_at, metadata, status, journey_stage')
        .eq('source', 'hr_csv_batch')
        .is('assigned_to_user_id', null)
        .order('created_at', { ascending: true })
        .limit(limit);
      if (batchId) query = query.eq('lead_batch_id', batchId);
      const { data, error } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, pool: data || [] }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && mode === 'assignments') {
      const batchId = url.searchParams.get('batch_id')?.trim() || '';
      let query = admin
        .from('pipeline_candidates')
        .select('id, full_name, email, phone, lead_batch_id, assigned_to_user_id, assigned_to_label, assigned_at, status, journey_stage, uploader_user_id, metadata')
        .eq('source', 'hr_csv_batch')
        .not('assigned_to_user_id', 'is', null)
        .order('assigned_at', { ascending: false })
        .limit(2000);
      if (batchId) query = query.eq('lead_batch_id', batchId);
      const { data, error } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, assignments: data || [] }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && mode === 'all-leads') {
      const batchId = url.searchParams.get('batch_id')?.trim() || '';
      const team = url.searchParams.get('team')?.trim().toLowerCase() || '';
      const status = url.searchParams.get('status')?.trim().toLowerCase() || 'all';
      const assigneeId = url.searchParams.get('assignee_id')?.trim() || '';
      const dateFrom = url.searchParams.get('date_from')?.trim() || '';
      const dateTo = url.searchParams.get('date_to')?.trim() || '';
      const search = url.searchParams.get('search')?.trim().toLowerCase() || '';
      const limit = Math.min(3000, Math.max(1, Number(url.searchParams.get('limit') || 2000)));

      let query = admin
        .from('pipeline_candidates')
        .select('id, full_name, email, phone, lead_batch_id, assigned_to_user_id, assigned_to_label, assigned_at, status, journey_stage, metadata, created_at')
        .eq('source', 'hr_csv_batch')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (batchId) query = query.eq('lead_batch_id', batchId);
      if (status === 'pool') query = query.is('assigned_to_user_id', null);
      if (status === 'assigned') query = query.not('assigned_to_user_id', 'is', null);
      if (assigneeId) query = query.eq('assigned_to_user_id', assigneeId);
      if (dateFrom) query = query.gte('created_at', `${dateFrom}T00:00:00.000Z`);
      if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59.999Z`);

      const { data: rows, error } = await query;
      if (error) throw error;

      const batchIds = [...new Set((rows || []).map((row) => String((row as { lead_batch_id?: string }).lead_batch_id || '')).filter(Boolean))];
      const batchMap = new Map<string, Record<string, unknown>>();
      if (batchIds.length) {
        const { data: batchRows } = await admin
          .from('pipeline_lead_batches')
          .select('id, label, source_filename, lead_team, created_at, imported_count, assigned_count')
          .in('id', batchIds);
        for (const batch of batchRows || []) {
          batchMap.set(String((batch as { id: string }).id), batch as Record<string, unknown>);
        }
      }

      const candidateIds = (rows || []).map((row) => String((row as { id: string }).id));
      const { latest } = await fetchDispositionMaps(admin, candidateIds);

      let leads = (rows || []).map((row) => {
        const r = row as Record<string, unknown>;
        const batchIdKey = String(r.lead_batch_id || '');
        const batch = batchMap.get(batchIdKey) || {};
        const meta = r.metadata && typeof r.metadata === 'object' ? (r.metadata as Record<string, unknown>) : {};
        const leadTeam = String(
          (batch as { lead_team?: string }).lead_team || meta.lead_age || '',
        ).trim();
        const latestRecord = latest.get(String(r.id));
        return {
          ...r,
          batch_label: String((batch as { label?: string }).label || ''),
          source_filename: String((batch as { source_filename?: string }).source_filename || ''),
          batch_created_at: String((batch as { created_at?: string }).created_at || r.created_at || ''),
          lead_team: leadTeam,
          latest_disposition: latestRecord?.disposition || null,
          latest_disposed_at: latestRecord?.disposed_at || null,
        };
      });

      if (team) {
        leads = leads.filter((lead) => String((lead as { lead_team?: string }).lead_team || '').toLowerCase().includes(team));
      }
      if (search) {
        leads = leads.filter((lead) => {
          const l = lead as Record<string, unknown>;
          const hay = [
            l.full_name,
            l.email,
            l.phone,
            l.batch_label,
            l.source_filename,
            l.lead_team,
          ].map((v) => String(v || '').toLowerCase()).join(' ');
          return hay.includes(search);
        });
      }

      const teams = [...new Set(leads.map((lead) => String((lead as { lead_team?: string }).lead_team || '').trim()).filter(Boolean))].sort();

      return new Response(JSON.stringify({ ok: true, leads, teams, total: leads.length }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && mode === 'recruiter-overview') {
      const batchId = url.searchParams.get('batch_id')?.trim() || '';
      let candidateQuery = admin
        .from('pipeline_candidates')
        .select('id, assigned_to_user_id, assigned_to_label')
        .eq('source', 'hr_csv_batch')
        .not('assigned_to_user_id', 'is', null);
      if (batchId) candidateQuery = candidateQuery.eq('lead_batch_id', batchId);
      const { data: candidates, error: candErr } = await candidateQuery;
      if (candErr) throw candErr;

      const rows = (candidates || []) as Array<{
        id: string;
        assigned_to_user_id: string | null;
        assigned_to_label: string | null;
      }>;
      const candidateIds = rows.map((row) => row.id);
      const { latest } = await fetchDispositionMaps(admin, candidateIds);

      const byRecruiter = new Map<string, {
        user_id: string;
        label: string;
        assigned_count: number;
        not_contacted_count: number;
        worked_count: number;
        disposition_counts: Record<string, number>;
      }>();

      for (const row of rows) {
        const userId = String(row.assigned_to_user_id || '').trim();
        if (!userId) continue;
        let bucket = byRecruiter.get(userId);
        if (!bucket) {
          bucket = {
            user_id: userId,
            label: String(row.assigned_to_label || userId).trim(),
            assigned_count: 0,
            not_contacted_count: 0,
            worked_count: 0,
            disposition_counts: emptyDispositionCounts(),
          };
          byRecruiter.set(userId, bucket);
        }
        bucket.assigned_count += 1;
        const latestRecord = latest.get(row.id);
        if (!latestRecord?.disposition) {
          bucket.not_contacted_count += 1;
        } else {
          bucket.worked_count += 1;
          incrementDispositionCount(bucket.disposition_counts, latestRecord.disposition);
        }
      }

      const recruiters = [...byRecruiter.values()].sort((a, b) => b.assigned_count - a.assigned_count);
      return new Response(JSON.stringify({ ok: true, recruiters }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && mode === 'recruiter-leads') {
      const userId = url.searchParams.get('user_id')?.trim() || '';
      const batchId = url.searchParams.get('batch_id')?.trim() || '';
      if (!userId) {
        return new Response(JSON.stringify({ error: 'user_id is required.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let leadQuery = admin
        .from('pipeline_candidates')
        .select('id, full_name, email, phone, lead_batch_id, assigned_to_user_id, assigned_to_label, assigned_at, status, journey_stage, uploader_user_id, metadata, created_at')
        .eq('source', 'hr_csv_batch')
        .eq('assigned_to_user_id', userId)
        .order('assigned_at', { ascending: false })
        .limit(2000);
      if (batchId) leadQuery = leadQuery.eq('lead_batch_id', batchId);
      const { data: leads, error: leadErr } = await leadQuery;
      if (leadErr) throw leadErr;

      const leadRows = (leads || []) as Array<{ id: string }>;
      const { latest, counts } = await fetchDispositionMaps(admin, leadRows.map((row) => row.id));

      const enriched = leadRows.map((lead) => {
        const latestRecord = latest.get(lead.id);
        return {
          ...lead,
          latest_disposition: latestRecord?.disposition || null,
          latest_disposed_at: latestRecord?.disposed_at || null,
          call_count: counts.get(lead.id) || 0,
        };
      });

      return new Response(JSON.stringify({ ok: true, leads: enriched }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && mode === 'summary') {
      const { count: poolCount } = await admin
        .from('pipeline_candidates')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'hr_csv_batch')
        .is('assigned_to_user_id', null);
      const { count: assignedCount } = await admin
        .from('pipeline_candidates')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'hr_csv_batch')
        .not('assigned_to_user_id', 'is', null);
      const recentBatches = await listBatchesWithPoolCounts(admin, 10);
      return new Response(JSON.stringify({
        ok: true,
        pool_count: poolCount ?? 0,
        assigned_count: assignedCount ?? 0,
        recent_batches: recentBatches,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST' && mode === 'import-rows') {
      const body = (await req.json().catch(() => ({}))) as {
        batch_id?: string;
        label?: string;
        source_filename?: string;
        lead_team?: string | null;
        rows?: ImportRow[];
      };
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) {
        return new Response(JSON.stringify({ error: 'No rows to import.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const sourceFilename = String(body.source_filename || '').trim();
      const resolvedLeadTeam =
        normalizeLeadTeam(body.lead_team) || inferLeadTeamFromFilename(sourceFilename);

      let batchId = String(body.batch_id || '').trim();
      if (!batchId) {
        const { data: batch, error: batchErr } = await admin
          .from('pipeline_lead_batches')
          .insert({
            created_by_user_id: user.id,
            created_by_label: actorLabel,
            label: String(body.label || sourceFilename || `Import ${new Date().toISOString().slice(0, 10)}`).trim(),
            source_filename: sourceFilename || null,
            lead_team: resolvedLeadTeam,
            total_rows: rows.length,
          })
          .select('*')
          .single();
        if (batchErr) throw batchErr;
        batchId = String((batch as { id: string }).id);
      }

      const { data: batchInfo } = await admin
        .from('pipeline_lead_batches')
        .select('label, created_at, source_filename, lead_team')
        .eq('id', batchId)
        .maybeSingle();
      const batchLabel = String((batchInfo as { label?: string } | null)?.label || body.label || sourceFilename || '').trim();
      const batchCreatedAt = String((batchInfo as { created_at?: string } | null)?.created_at || new Date().toISOString());
      const batchLeadTeam =
        normalizeLeadTeam((batchInfo as { lead_team?: string } | null)?.lead_team) ||
        resolvedLeadTeam;
      const batchSourceFilename =
        String((batchInfo as { source_filename?: string } | null)?.source_filename || sourceFilename || '').trim();

      const imported: string[] = [];
      const skipped: Array<{ row_number: number; reason: string }> = [];
      const failed: Array<{ row_number: number; error: string }> = [];

      for (const row of rows) {
        const rowNumber = Number(row.row_number || 0) || 0;
        const email = normalizeEmail(row.email);
        const phone = normalizePhone(row.phone);
        const fullName = String(row.full_name || '').trim() || email || phone || 'Unknown Candidate';

        if (!email && !phone) {
          failed.push({ row_number: rowNumber, error: 'Email or phone required.' });
          continue;
        }

        if (email) {
          const { data: existing } = await admin
            .from('pipeline_candidates')
            .select('id, assigned_to_user_id, assigned_to_label')
            .eq('source', 'hr_csv_batch')
            .ilike('email', email)
            .in('status', ['open', 'in_progress'])
            .limit(1);
          if (existing?.length) {
            skipped.push({
              row_number: rowNumber,
              reason: existing[0].assigned_to_user_id
                ? `Already assigned to ${existing[0].assigned_to_label || 'another recruiter'}.`
                : 'Already in the unassigned pool.',
            });
            continue;
          }
        }

        const { data: inserted, error: insErr } = await admin
          .from('pipeline_candidates')
          .insert({
            full_name: fullName,
            email,
            phone,
            source: 'hr_csv_batch',
            uploader_user_id: null,
            uploader_label: null,
            lead_batch_id: batchId,
            metadata: {
              lead_age: row.lead_age || null,
              lead_team: batchLeadTeam,
              csv_row_number: rowNumber || null,
              import_source: 'hr_csv_batch',
              lead_batch_label: batchLabel || null,
              lead_batch_created_at: batchCreatedAt,
              lead_source_filename: batchSourceFilename || null,
            },
          })
          .select('id')
          .single();

        if (insErr) {
          const msg = insErr.message || 'Insert failed';
          if (/unique|duplicate/i.test(msg) && email) {
            skipped.push({ row_number: rowNumber, reason: 'Duplicate email already assigned in pipeline.' });
          } else {
            failed.push({ row_number: rowNumber, error: msg });
          }
          continue;
        }
        imported.push(String((inserted as { id: string }).id));
      }

      const { data: batchRow } = await admin
        .from('pipeline_lead_batches')
        .select('imported_count, skipped_duplicate_count, failed_count, total_rows')
        .eq('id', batchId)
        .maybeSingle();

      const nextImported = Number((batchRow as { imported_count?: number } | null)?.imported_count || 0) + imported.length;
      const nextSkipped = Number((batchRow as { skipped_duplicate_count?: number } | null)?.skipped_duplicate_count || 0) + skipped.length;
      const nextFailed = Number((batchRow as { failed_count?: number } | null)?.failed_count || 0) + failed.length;
      const nextTotal = Math.max(
        Number((batchRow as { total_rows?: number } | null)?.total_rows || 0),
        nextImported + nextSkipped + nextFailed,
      );

      await admin
        .from('pipeline_lead_batches')
        .update({
          imported_count: nextImported,
          skipped_duplicate_count: nextSkipped,
          failed_count: nextFailed,
          total_rows: nextTotal,
        })
        .eq('id', batchId);

      return new Response(JSON.stringify({
        ok: true,
        batch_id: batchId,
        imported_ids: imported,
        imported_count: imported.length,
        skipped,
        failed,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST' && mode === 'assign') {
      const body = (await req.json().catch(() => ({}))) as {
        candidate_ids?: string[];
        assign_to_user_id?: string;
        assign_to_label?: string;
        count?: number;
        batch_id?: string;
      };
      const assignToUserId = String(body.assign_to_user_id || '').trim();
      const assignToLabel = String(body.assign_to_label || '').trim() || null;
      if (!assignToUserId) {
        return new Response(JSON.stringify({ error: 'assign_to_user_id is required.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let candidateIds = [...new Set((body.candidate_ids || []).map((id) => String(id).trim()).filter(Boolean))];
      const count = Math.max(0, Number(body.count || 0));
      const batchId = String(body.batch_id || '').trim();

      if (!candidateIds.length && count > 0) {
        let poolQuery = admin
          .from('pipeline_candidates')
          .select('id')
          .eq('source', 'hr_csv_batch')
          .is('assigned_to_user_id', null)
          .order('created_at', { ascending: true })
          .limit(count);
        if (batchId) poolQuery = poolQuery.eq('lead_batch_id', batchId);
        const { data: poolRows, error: poolErr } = await poolQuery;
        if (poolErr) throw poolErr;
        candidateIds = (poolRows || []).map((row) => String((row as { id: string }).id));
      }

      if (!candidateIds.length) {
        return new Response(JSON.stringify({ error: 'No pool leads selected to assign.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const nowIso = new Date().toISOString();
      const assigned: string[] = [];
      const errors: Array<{ id: string; error: string }> = [];

      for (const candidateId of candidateIds) {
        const { data: existing, error: getErr } = await admin
          .from('pipeline_candidates')
          .select('id, assigned_to_user_id, assigned_to_label, lead_batch_id, source, metadata')
          .eq('id', candidateId)
          .maybeSingle();
        if (getErr || !existing) {
          errors.push({ id: candidateId, error: 'Lead not found.' });
          continue;
        }
        const row = existing as Record<string, unknown>;
        if (String(row.source || '') !== 'hr_csv_batch') {
          errors.push({ id: candidateId, error: 'Not an HR pool lead.' });
          continue;
        }
        if (row.assigned_to_user_id) {
          errors.push({
            id: candidateId,
            error: `Already assigned to ${String(row.assigned_to_label || 'another recruiter')}.`,
          });
          continue;
        }

        const { data: batchRow } = row.lead_batch_id
          ? await admin
            .from('pipeline_lead_batches')
            .select('label, created_at, lead_team, source_filename')
            .eq('id', String(row.lead_batch_id))
            .maybeSingle()
          : { data: null };

        const existingMeta =
          row.metadata && typeof row.metadata === 'object'
            ? (row.metadata as Record<string, unknown>)
            : {};
        const batchLabel = String((batchRow as { label?: string } | null)?.label || existingMeta.lead_batch_label || '').trim();
        const batchCreatedAt = String(
          (batchRow as { created_at?: string } | null)?.created_at || existingMeta.lead_batch_created_at || '',
        ).trim();
        const batchLeadTeam =
          normalizeLeadTeam((batchRow as { lead_team?: string } | null)?.lead_team) ||
          normalizeLeadTeam(String(existingMeta.lead_team || '')) ||
          inferLeadTeamFromFilename(String((batchRow as { source_filename?: string } | null)?.source_filename || existingMeta.lead_source_filename || ''));
        const batchSourceFilename = String(
          (batchRow as { source_filename?: string } | null)?.source_filename || existingMeta.lead_source_filename || '',
        ).trim();

        const { error: upErr } = await admin
          .from('pipeline_candidates')
          .update({
            uploader_user_id: assignToUserId,
            uploader_label: assignToLabel,
            assigned_to_user_id: assignToUserId,
            assigned_to_label: assignToLabel,
            assigned_at: nowIso,
            assigned_by_user_id: user.id,
            status: 'open',
            journey_stage: 'new',
            metadata: {
              ...existingMeta,
              lead_batch_label: batchLabel || existingMeta.lead_batch_label || null,
              lead_batch_created_at: batchCreatedAt || existingMeta.lead_batch_created_at || null,
              lead_team: batchLeadTeam || existingMeta.lead_team || null,
              lead_source_filename: batchSourceFilename || existingMeta.lead_source_filename || null,
              assigned_at: nowIso,
            },
          })
          .eq('id', candidateId)
          .is('assigned_to_user_id', null);

        if (upErr) {
          errors.push({ id: candidateId, error: upErr.message });
          continue;
        }
        assigned.push(candidateId);

        const leadBatchId = String(row.lead_batch_id || '');
        if (leadBatchId) {
          const { data: batch } = await admin
            .from('pipeline_lead_batches')
            .select('assigned_count')
            .eq('id', leadBatchId)
            .maybeSingle();
          const nextAssigned = Number((batch as { assigned_count?: number } | null)?.assigned_count || 0) + 1;
          await admin.from('pipeline_lead_batches').update({ assigned_count: nextAssigned }).eq('id', leadBatchId);
        }
      }

      return new Response(JSON.stringify({
        ok: true,
        assigned_ids: assigned,
        assigned_count: assigned.length,
        errors,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST' && mode === 'retract-assignment') {
      const body = (await req.json().catch(() => ({}))) as { candidate_ids?: string[] };
      const candidateIds = Array.isArray(body.candidate_ids)
        ? body.candidate_ids.map((id) => String(id).trim()).filter(Boolean)
        : [];
      if (!candidateIds.length) {
        return new Response(JSON.stringify({ error: 'No leads selected to retract.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const result = await retractHrAssignments(admin, candidateIds);
      return new Response(JSON.stringify({
        ok: true,
        retracted_count: result.retracted_ids.length,
        retracted_ids: result.retracted_ids,
        errors: result.errors,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST' && mode === 'retract-batch') {
      const body = (await req.json().catch(() => ({}))) as {
        batch_id?: string;
        assignee_user_id?: string;
      };
      const batchId = String(body.batch_id || '').trim();
      const assigneeUserId = String(body.assignee_user_id || '').trim();
      if (!batchId) {
        return new Response(JSON.stringify({ error: 'batch_id is required.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      let query = admin
        .from('pipeline_candidates')
        .select('id')
        .eq('source', 'hr_csv_batch')
        .eq('lead_batch_id', batchId)
        .not('assigned_to_user_id', 'is', null);
      if (assigneeUserId) query = query.eq('assigned_to_user_id', assigneeUserId);

      const { data: rows, error: listErr } = await query;
      if (listErr) throw listErr;
      const candidateIds = (rows || []).map((row) => String((row as { id: string }).id));
      const result = await retractHrAssignments(admin, candidateIds);
      return new Response(JSON.stringify({
        ok: true,
        retracted_count: result.retracted_ids.length,
        retracted_ids: result.retracted_ids,
        errors: result.errors,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST' && mode === 'delete-leads') {
      const body = (await req.json().catch(() => ({}))) as { candidate_ids?: string[] };
      const candidateIds = Array.isArray(body.candidate_ids)
        ? body.candidate_ids.map((id) => String(id).trim()).filter(Boolean)
        : [];
      if (!candidateIds.length) {
        return new Response(JSON.stringify({ error: 'No leads selected to delete.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: pendingRows } = await admin
        .from('pipeline_candidates')
        .select('id, lead_batch_id')
        .in('id', candidateIds);
      const touchedBatches = new Set<string>();
      for (const row of pendingRows || []) {
        const batchId = String((row as { lead_batch_id?: string | null }).lead_batch_id || '');
        if (batchId) touchedBatches.add(batchId);
      }
      const result = await deleteHrPoolCandidates(admin, candidateIds);
      const removedBatches: string[] = [];
      for (const batchId of touchedBatches) {
        if (await cleanupBatchIfEmpty(admin, batchId)) removedBatches.push(batchId);
      }
      return new Response(JSON.stringify({
        ok: true,
        deleted_count: result.deleted_ids.length,
        deleted_ids: result.deleted_ids,
        removed_batch_ids: removedBatches,
        errors: result.errors,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST' && mode === 'delete-batch-pool') {
      const body = (await req.json().catch(() => ({}))) as { batch_id?: string };
      const batchId = String(body.batch_id || '').trim();
      if (!batchId) {
        return new Response(JSON.stringify({ error: 'batch_id is required.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: poolRows, error: poolErr } = await admin
        .from('pipeline_candidates')
        .select('id')
        .eq('source', 'hr_csv_batch')
        .eq('lead_batch_id', batchId)
        .is('assigned_to_user_id', null);
      if (poolErr) throw poolErr;
      const candidateIds = (poolRows || []).map((row) => String((row as { id: string }).id));
      const result = await deleteHrPoolCandidates(admin, candidateIds);
      const batchRemoved = await cleanupBatchIfEmpty(admin, batchId);
      return new Response(JSON.stringify({
        ok: true,
        deleted_count: result.deleted_ids.length,
        deleted_ids: result.deleted_ids,
        batch_removed: batchRemoved,
        errors: result.errors,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: `Unsupported mode: ${mode || '(missing)'}` }), {
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
