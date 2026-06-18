// Manual weekly leaderboard email (admin only).
// Deploy: supabase functions deploy send-weekly-leaderboard-email
// Secrets: SMTP_* (same as send-email), optional WEEKLY_LEADERBOARD_EMAIL (default ali@globelife-paz.com)

import nodemailer from 'npm:nodemailer@6.9.10';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { insertEmailSendLog } from '../_shared/emailSendLog.ts';
import {
  buildWeeklyLeaderboardEmailHtml,
  buildWeeklyLeaderboardEmailSubject,
  type WeeklyLeaderboardEmailInput,
  type WeeklyLeaderboardEmailRow,
} from '../_shared/weeklyLeaderboardEmailHtml.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
};

const DEFAULT_RECIPIENT = 'ali@globelife-paz.com';

function getTransport() {
  const host = Deno.env.get('SMTP_HOSTNAME')?.trim();
  const port = Number(Deno.env.get('SMTP_PORT') ?? 587);
  const secure = (Deno.env.get('SMTP_SECURE') ?? 'false') === 'true';
  const user = Deno.env.get('SMTP_USERNAME')?.trim();
  const pass = Deno.env.get('SMTP_PASSWORD')?.trim();
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: Number.isNaN(port) ? 587 : port,
    secure,
    auth: { user, pass },
    ...(port === 587 && !secure ? { requireTLS: true } : {}),
  });
}

function parseRow(raw: unknown): WeeklyLeaderboardEmailRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const displayName = String(r.displayName || '').trim();
  if (!displayName) return null;
  return {
    rank: Number(r.rank) || 0,
    displayName,
    score: Number(r.score) || 0,
    calls: Number(r.calls) || 0,
    webinarBooked: Number(r.webinarBooked) || 0,
    webinarShowed: Number(r.webinarShowed) || 0,
    liveSessionBooked: Number(r.liveSessionBooked) || 0,
    liveSessionShowed: Number(r.liveSessionShowed) || 0,
    showRatio: Number(r.showRatio) || 0,
    rankDelta: Number(r.rankDelta) || 0,
    periodCoins: Number(r.periodCoins) || 0,
    coinBalance: Number(r.coinBalance) || 0,
    badges: Array.isArray(r.badges) ? r.badges.map((b) => String(b)) : [],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
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
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(supabaseUrl, serviceRole);
    const { data: profile } = await admin
      .from('user_profiles')
      .select('role, email')
      .eq('user_id', user.id)
      .maybeSingle();

    if (String(profile?.role || '') !== 'admin') {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const rows = (Array.isArray(body.rows) ? body.rows : [])
      .map(parseRow)
      .filter((r): r is WeeklyLeaderboardEmailRow => Boolean(r));

    if (!rows.length) {
      return new Response(JSON.stringify({ error: 'No leaderboard rows to email. Refresh rankings first.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const emailInput: WeeklyLeaderboardEmailInput = {
      windowLabel: String(body.windowLabel || 'Leaderboard period').trim(),
      periodKey: String(body.periodKey || '').trim(),
      fetchedAt: body.fetchedAt ? String(body.fetchedAt) : null,
      rows,
      topPerformerName: body.topPerformerName ? String(body.topPerformerName) : null,
      fastClimberName: body.fastClimberName ? String(body.fastClimberName) : null,
      consistentCloserName: body.consistentCloserName ? String(body.consistentCloserName) : null,
      previousTopPerformerName: body.previousTopPerformerName ? String(body.previousTopPerformerName) : null,
      appUrl: String(body.appUrl || Deno.env.get('OPS_APP_URL') || 'https://paz-talent-journey.vercel.app'),
    };

    const transport = getTransport();
    if (!transport) {
      return new Response(JSON.stringify({ error: 'SMTP not configured on server' }), {
        status: 503,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const toEmail = (Deno.env.get('WEEKLY_LEADERBOARD_EMAIL') || DEFAULT_RECIPIENT).trim();
    const fromEmail =
      Deno.env.get('SMTP_FROM')?.trim() ||
      Deno.env.get('SMTP_USERNAME')?.trim() ||
      '';
    const subject = buildWeeklyLeaderboardEmailSubject(emailInput.windowLabel);
    const html = buildWeeklyLeaderboardEmailHtml(emailInput);

    try {
      await transport.sendMail({
        from: fromEmail,
        to: toEmail,
        subject,
        html,
      });
      await insertEmailSendLog(admin, {
        source: 'send-weekly-leaderboard-email',
        trigger_label: 'weekly_leaderboard_manual',
        from_email: fromEmail,
        to_email: toEmail,
        subject,
        sent_by_user_id: user.id,
        status: 'sent',
        metadata: {
          category: 'staff_internal',
          period_key: emailInput.periodKey,
          row_count: rows.length,
          window_label: emailInput.windowLabel,
        },
      });
    } catch (mailErr) {
      const message = mailErr instanceof Error ? mailErr.message : String(mailErr);
      await insertEmailSendLog(admin, {
        source: 'send-weekly-leaderboard-email',
        trigger_label: 'weekly_leaderboard_manual',
        from_email: fromEmail,
        to_email: toEmail,
        subject,
        sent_by_user_id: user.id,
        status: 'failed',
        error_message: message,
        metadata: { period_key: emailInput.periodKey },
      });
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify({ ok: true, to: toEmail, subject, rowCount: rows.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('send-weekly-leaderboard-email:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
