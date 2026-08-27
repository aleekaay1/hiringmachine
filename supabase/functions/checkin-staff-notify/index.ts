import nodemailer from 'npm:nodemailer@6.9.10';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { mergePortalBcc } from '../_shared/portalEmailBcc.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const DEFAULT_TO = 'ali@globelife-paz.com';

const PROVINCE_LABELS: Record<string, string> = {
  AB: 'Alberta',
  BC: 'British Columbia',
  MB: 'Manitoba',
  NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador',
  NS: 'Nova Scotia',
  NT: 'Northwest Territories',
  NU: 'Nunavut',
  ON: 'Ontario',
  PE: 'Prince Edward Island',
  QC: 'Quebec',
  SK: 'Saskatchewan',
  YT: 'Yukon',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getTransport() {
  const host = Deno.env.get('SMTP_HOSTNAME')?.trim();
  const port = Number(Deno.env.get('SMTP_PORT') ?? 587);
  const secure = (Deno.env.get('SMTP_SECURE') ?? 'false') === 'true';
  const user = Deno.env.get('SMTP_USERNAME')?.trim();
  const pass = Deno.env.get('SMTP_PASSWORD')?.trim();
  if (!host || !user || !pass) {
    throw new Error('Missing SMTP config');
  }
  return nodemailer.createTransport({
    host,
    port: Number.isNaN(port) ? 587 : port,
    secure,
    auth: { user, pass },
    ...(port === 587 && !secure ? { requireTLS: true } : {}),
  });
}

function yesNo(value: unknown): string {
  if (value === 'yes') return 'Yes';
  if (value === 'no') return 'No';
  return '—';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method === 'GET') return json(200, { ok: true, service: 'checkin-staff-notify' });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  try {
    const body = await req.json().catch(() => ({})) as { candidateId?: string };
    const candidateId = String(body.candidateId || '').trim();
    if (!candidateId) return json(400, { error: 'Missing candidateId' });

    const url = Deno.env.get('SUPABASE_URL') || '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() || '';
    if (!url || !serviceKey) return json(500, { error: 'Server misconfiguration' });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: row, error } = await admin
      .from('candidates')
      .select('id, first_name, last_name, email, phone, city, timestamp, admin_data, applicant_questionnaire')
      .eq('id', candidateId)
      .maybeSingle();
    if (error) return json(500, { error: error.message });
    if (!row) return json(404, { error: 'Check-in not found' });

    const adminData = (row.admin_data && typeof row.admin_data === 'object'
      ? row.admin_data
      : {}) as Record<string, unknown>;
    const tags = Array.isArray(adminData.tags) ? adminData.tags.map(String) : [];
    if (tags.includes('checkin_staff_notified')) {
      return json(200, { ok: true, skipped: true });
    }

    const q = (row.applicant_questionnaire && typeof row.applicant_questionnaire === 'object'
      ? row.applicant_questionnaire
      : {}) as Record<string, unknown>;
    const first = String(row.first_name || '').trim();
    const last = String(row.last_name || '').trim();
    const name = `${first} ${last}`.trim() || 'Unknown';
    const email = String(row.email || '').trim();
    const phone = String(row.phone || '').trim() || '—';
    const city = String(row.city || '').trim() || '—';
    const provinceCode = String(q.province || '').trim();
    const province = PROVINCE_LABELS[provinceCode] || provinceCode || '—';
    const entitled = yesNo(q.legallyEntitledCanada);
    const remote = yesNo(q.comfortableVirtualEnvironment);
    const notEligible = tags.includes('not_eligible_canada') || q.legallyEntitledCanada === 'no';

    const to = (Deno.env.get('CHECKIN_NOTIFY_TO') || DEFAULT_TO).trim();
    const from =
      Deno.env.get('SMTP_FROM')?.trim() ||
      Deno.env.get('SMTP_USERNAME')?.trim() ||
      'noreply@example.com';
    const subject = notEligible
      ? `Check-in (not eligible): ${name}`
      : `New check-in: ${name}`;
    const html = `
      <p>Someone just submitted the AO Paz check-in form.</p>
      ${notEligible ? '<p><strong>Flag:</strong> not legally entitled to work in Canada.</p>' : ''}
      <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
        <tr><td><strong>Name</strong></td><td>${escapeHtml(name)}</td></tr>
        <tr><td><strong>Email</strong></td><td>${escapeHtml(email)}</td></tr>
        <tr><td><strong>Phone</strong></td><td>${escapeHtml(phone)}</td></tr>
        <tr><td><strong>City</strong></td><td>${escapeHtml(city)}</td></tr>
        <tr><td><strong>Province</strong></td><td>${escapeHtml(province)}</td></tr>
        <tr><td><strong>Legally entitled to work in Canada</strong></td><td>${escapeHtml(entitled)}</td></tr>
        <tr><td><strong>Comfortable 100% remote</strong></td><td>${escapeHtml(remote)}</td></tr>
      </table>
      <p style="color:#666;font-size:12px">This is an automated notice from the hiring portal.</p>
    `.trim();

    const transport = getTransport();
    await transport.sendMail({
      from,
      to,
      bcc: mergePortalBcc(),
      subject,
      html,
      text:
        `New check-in: ${name}\nEmail: ${email}\nPhone: ${phone}\nCity: ${city}\nProvince: ${province}\n` +
        `Legally entitled to work in Canada: ${entitled}\nComfortable 100% remote: ${remote}` +
        (notEligible ? '\nFlag: not legally entitled to work in Canada.' : ''),
    });

    await admin.from('candidates').update({
      admin_data: {
        ...adminData,
        tags: Array.from(new Set([...tags, 'checkin_staff_notified'])),
      },
    }).eq('id', candidateId);

    return json(200, { ok: true, to });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
});
