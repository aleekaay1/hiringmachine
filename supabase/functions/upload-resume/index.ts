// Resume upload via Edge Function (service role bypasses Storage RLS).
// Deploy: supabase functions deploy upload-resume
// Secrets: SUPABASE_SERVICE_ROLE_KEY (auto on hosted projects)

import { createClient } from 'npm:@supabase/supabase-js@2';

const MB = 1024 * 1024;
const BUCKET = 'candidate-resumes';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
  'Access-Control-Max-Age': '86400',
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return json(400, { error: 'Expected multipart/form-data' });
    }

    const formData = await req.formData();
    const candidateId = String(formData.get('candidateId') ?? '').trim();
    const fileEntry = formData.get('file');

    if (!candidateId || !fileEntry || !(fileEntry instanceof Blob)) {
      return json(400, { error: 'Missing candidateId or file' });
    }

    if (fileEntry.size > 10 * MB) {
      return json(400, { error: 'File too large (max 10MB)' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
      return json(500, { error: 'Server configuration error' });
    }

    const safeName =
      fileEntry instanceof File
        ? (fileEntry.name || 'file').replace(/[^a-zA-Z0-9.-]/g, '_')
        : 'upload.bin';
    const path = `${candidateId}/${Date.now()}-${safeName}`;

    const buffer = await fileEntry.arrayBuffer();
    const mime = fileEntry instanceof File && fileEntry.type ? fileEntry.type : 'application/octet-stream';

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType: mime,
      cacheControl: '3600',
      upsert: false,
    });

    if (error) {
      console.error('Storage upload error:', error);
      return json(500, { error: error.message });
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return json(200, { url: data.publicUrl });
  } catch (e) {
    console.error('upload-resume:', e);
    return json(500, { error: e instanceof Error ? e.message : 'Upload failed' });
  }
});
