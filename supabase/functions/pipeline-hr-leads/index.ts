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
      const { data, error } = await admin
        .from('pipeline_lead_batches')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, batches: data || [] }), {
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
        .select('id, full_name, email, phone, lead_batch_id, assigned_to_user_id, assigned_to_label, assigned_at, status, journey_stage, uploader_user_id')
        .eq('source', 'hr_csv_batch')
        .not('assigned_to_user_id', 'is', null)
        .order('assigned_at', { ascending: false })
        .limit(500);
      if (batchId) query = query.eq('lead_batch_id', batchId);
      const { data, error } = await query;
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, assignments: data || [] }), {
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
      const { data: batches } = await admin
        .from('pipeline_lead_batches')
        .select('id, label, created_at, imported_count, assigned_count, total_rows')
        .order('created_at', { ascending: false })
        .limit(10);
      return new Response(JSON.stringify({
        ok: true,
        pool_count: poolCount ?? 0,
        assigned_count: assignedCount ?? 0,
        recent_batches: batches || [],
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

      let batchId = String(body.batch_id || '').trim();
      if (!batchId) {
        const { data: batch, error: batchErr } = await admin
          .from('pipeline_lead_batches')
          .insert({
            created_by_user_id: user.id,
            created_by_label: actorLabel,
            label: String(body.label || body.source_filename || `Import ${new Date().toISOString().slice(0, 10)}`).trim(),
            source_filename: body.source_filename || null,
            lead_team: body.lead_team || null,
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
      const batchLabel = String((batchInfo as { label?: string } | null)?.label || body.label || body.source_filename || '').trim();
      const batchCreatedAt = String((batchInfo as { created_at?: string } | null)?.created_at || new Date().toISOString());

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
              csv_row_number: rowNumber || null,
              import_source: 'hr_csv_batch',
              lead_batch_label: batchLabel || null,
              lead_batch_created_at: batchCreatedAt,
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
            .select('label, created_at')
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
