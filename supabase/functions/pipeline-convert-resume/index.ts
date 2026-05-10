import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type ResumeRow = {
  id: string;
  candidate_id: string;
  storage_bucket: string;
  storage_path: string;
  public_url: string | null;
  original_filename: string;
  mime_type: string | null;
  converted_pdf_path: string | null;
  converted_pdf_url: string | null;
  conversion_status: string;
};

async function uploadConvertedPdf(
  admin: ReturnType<typeof createClient>,
  bucket: string,
  candidateId: string,
  resumeId: string,
  pdfBytes: Uint8Array,
): Promise<{ path: string; url: string }> {
  const path = `${candidateId}/converted-${resumeId}-${Date.now()}.pdf`;
  const { error } = await admin.storage.from(bucket).upload(path, pdfBytes, {
    contentType: 'application/pdf',
    cacheControl: '3600',
    upsert: true,
  });
  if (error) throw error;
  const { data } = admin.storage.from(bucket).getPublicUrl(path);
  return { path, url: data.publicUrl };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json(401, { error: 'Unauthorized' });

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: authData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !authData.user) return json(401, { error: 'Invalid or expired session' });

    const body = (await req.json().catch(() => ({}))) as { resume_id?: string };
    const resumeId = String(body.resume_id || '').trim();
    if (!resumeId) return json(400, { error: 'resume_id is required' });

    const { data: resume, error: resumeErr } = await admin
      .from('pipeline_resumes')
      .select('id,candidate_id,storage_bucket,storage_path,public_url,original_filename,mime_type,converted_pdf_path,converted_pdf_url,conversion_status')
      .eq('id', resumeId)
      .maybeSingle();
    if (resumeErr) return json(500, { error: resumeErr.message });
    if (!resume) return json(404, { error: 'Resume not found' });
    const row = resume as ResumeRow;

    const mime = String(row.mime_type || '').toLowerCase();
    if (mime.includes('pdf') || mime.startsWith('image/')) {
      await admin.from('pipeline_resumes').update({
        conversion_status: 'not_required',
        conversion_error: null,
      }).eq('id', row.id);
      return json(200, { ok: true, status: 'not_required' });
    }

    await admin.from('pipeline_resumes').update({
      conversion_status: 'processing',
      conversion_error: null,
    }).eq('id', row.id);

    const converterUrl = Deno.env.get('PIPELINE_DOC_CONVERTER_URL')?.trim();
    const converterApiKey = Deno.env.get('PIPELINE_DOC_CONVERTER_API_KEY')?.trim() || '';
    if (!converterUrl) {
      await admin.from('pipeline_resumes').update({
        conversion_status: 'failed',
        conversion_error: 'PIPELINE_DOC_CONVERTER_URL is not configured',
      }).eq('id', row.id);
      return json(400, { error: 'Converter not configured', status: 'failed' });
    }

    const sourceUrl = row.public_url;
    if (!sourceUrl) {
      await admin.from('pipeline_resumes').update({
        conversion_status: 'failed',
        conversion_error: 'Missing source file URL',
      }).eq('id', row.id);
      return json(400, { error: 'Missing source file URL', status: 'failed' });
    }

    const convertRes = await fetch(converterUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(converterApiKey ? { Authorization: `Bearer ${converterApiKey}` } : {}),
      },
      body: JSON.stringify({
        input_url: sourceUrl,
        filename: row.original_filename,
        output: 'pdf',
      }),
    });
    const convertJson = (await convertRes.json().catch(() => ({}))) as {
      pdf_base64?: string;
      pdf_url?: string;
      error?: string;
    };
    if (!convertRes.ok) {
      const message = String(convertJson.error || `Converter failed (${convertRes.status})`);
      await admin.from('pipeline_resumes').update({
        conversion_status: 'failed',
        conversion_error: message,
      }).eq('id', row.id);
      return json(502, { error: message, status: 'failed' });
    }

    let convertedPath: string | null = null;
    let convertedUrl: string | null = null;
    if (convertJson.pdf_base64) {
      const bytes = Uint8Array.from(atob(convertJson.pdf_base64), (c) => c.charCodeAt(0));
      const uploaded = await uploadConvertedPdf(admin, row.storage_bucket, row.candidate_id, row.id, bytes);
      convertedPath = uploaded.path;
      convertedUrl = uploaded.url;
    } else if (convertJson.pdf_url) {
      convertedUrl = convertJson.pdf_url;
    } else {
      await admin.from('pipeline_resumes').update({
        conversion_status: 'failed',
        conversion_error: 'Converter returned no pdf payload',
      }).eq('id', row.id);
      return json(502, { error: 'Converter returned no pdf payload', status: 'failed' });
    }

    await admin.from('pipeline_resumes').update({
      conversion_status: 'ready',
      converted_pdf_path: convertedPath,
      converted_pdf_url: convertedUrl,
      conversion_error: null,
    }).eq('id', row.id);

    return json(200, {
      ok: true,
      status: 'ready',
      converted_pdf_path: convertedPath,
      converted_pdf_url: convertedUrl,
    });
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : String(error) });
  }
});
