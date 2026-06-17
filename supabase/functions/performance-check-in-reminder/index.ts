// Mid-week performance check-in reminder emails (Mon/Tue Toronto).
// DISABLED by default — set PERFORMANCE_CHECKIN_AUTOMATION_ENABLED=true on Edge to send.
// Invoke on schedule with: x-cron-secret: <PERFORMANCE_CHECKIN_CRON_SECRET>
// Deploy: supabase functions deploy performance-check-in-reminder
// Test: POST .../performance-check-in-reminder?dry_run=true

import nodemailer from 'npm:nodemailer@6.9.10';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { insertEmailSendLog } from '../_shared/emailSendLog.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info, x-cron-secret',
};

const APP_URL = (Deno.env.get('OPS_APP_URL') || 'https://paz-talent-journey.vercel.app').replace(/\/$/, '');

/** Flip with Edge secret PERFORMANCE_CHECKIN_AUTOMATION_ENABLED=true when re-enabling. */
const MID_WEEK_COACHING_ENABLED = false;

type ProfileRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
};

type SettingsRow = {
  user_id: string;
  daily_upload_target: number | null;
  daily_webinar_booking_target: number | null;
};

type CallRow = {
  recruiter_user_id: string | null;
  disposition: string | null;
};

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

function torontoYmd(d = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = p.find((x) => x.type === 'year')?.value ?? '1970';
  const mo = p.find((x) => x.type === 'month')?.value ?? '01';
  const da = p.find((x) => x.type === 'day')?.value ?? '01';
  return `${y}-${mo}-${da}`;
}

function torontoWeekdayIndex(d = new Date()): number {
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    weekday: 'short',
  }).format(d);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[label] ?? 0;
}

function isMidWeekDay(d = new Date()): boolean {
  const idx = torontoWeekdayIndex(d);
  return idx === 1 || idx === 2;
}

function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function localDateToYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fridayWeekBounds(ymd: string): { since: string; until: string } {
  const d = ymdToDate(ymd);
  const dow = d.getDay();
  const offsetToFriday = (dow + 2) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - offsetToFriday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { since: localDateToYmd(start), until: localDateToYmd(end) };
}

function elapsedDays(weekSince: string, todayYmd: string): number {
  const week = fridayWeekBounds(todayYmd);
  if (week.since !== weekSince) {
    const end = fridayWeekBounds(weekSince);
    if (todayYmd < weekSince || todayYmd > end.until) return 0;
  }
  if (todayYmd < weekSince) return 0;
  const endYmd = fridayWeekBounds(weekSince).until;
  const capped = todayYmd > endYmd ? endYmd : todayYmd;
  const start = ymdToDate(weekSince);
  const today = ymdToDate(capped);
  return Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86400000) + 1);
}

function computePace(input: {
  dailyCallTarget: number | null;
  dailyBookingTarget: number | null;
  actualCalls: number;
  actualBooked: number;
  elapsedDays: number;
}) {
  let below = false;
  let expectedCalls: number | null = null;
  let expectedBookings: number | null = null;
  let callsPacePct: number | null = null;
  let bookingsPacePct: number | null = null;

  if (input.dailyCallTarget && input.dailyCallTarget > 0 && input.elapsedDays > 0) {
    expectedCalls = input.dailyCallTarget * input.elapsedDays;
    callsPacePct = expectedCalls > 0 ? Math.round((input.actualCalls / expectedCalls) * 10000) / 100 : null;
    if (callsPacePct !== null && callsPacePct < 50) below = true;
  }
  if (input.dailyBookingTarget && input.dailyBookingTarget > 0 && input.elapsedDays > 0) {
    expectedBookings = input.dailyBookingTarget * input.elapsedDays;
    bookingsPacePct =
      expectedBookings > 0 ? Math.round((input.actualBooked / expectedBookings) * 10000) / 100 : null;
    if (bookingsPacePct !== null && bookingsPacePct < 50) below = true;
  }

  return { expectedCalls, expectedBookings, callsPacePct, bookingsPacePct, belowThreshold: below };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildEmailHtml(input: {
  firstName: string;
  weekLabel: string;
  callsPacePct: number | null;
  bookingsPacePct: number | null;
  actualCalls: number;
  actualBooked: number;
  expectedCalls: number | null;
  expectedBookings: number | null;
  dailyCallTarget: number | null;
  dailyBookingTarget: number | null;
  elapsedDays: number;
  formUrl: string;
}): string {
  const paceCell = (pct: number | null, actual: number, expected: number | null, label: string) => {
    const color = pct !== null && pct < 50 ? '#e11d48' : '#0B1B34';
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e8f0fa;color:#5c7594">${escapeHtml(label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e8f0fa;font-weight:600;color:${color}">${actual} / ${expected ?? '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e8f0fa;font-weight:600;color:${color}">${pct !== null ? `${pct}%` : '—'}</td>
    </tr>`;
  };

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#0B1B34;line-height:1.5;max-width:560px">
  <p>Hi ${escapeHtml(input.firstName)},</p>
  <p>Mid-week pulse check for <strong>${escapeHtml(input.weekLabel)}</strong> (day ${input.elapsedDays} of the Fri–Thu week).</p>
  <p>You are pacing <strong>below 50%</strong> on at least one target. Here is your snapshot:</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fbff;border-radius:12px;overflow:hidden">
    <thead>
      <tr style="background:#eef6ff">
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#4e79a9">Metric</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#4e79a9">Actual / expected</th>
        <th style="padding:8px 12px;text-align:left;font-size:12px;color:#4e79a9">Pace</th>
      </tr>
    </thead>
    <tbody>
      ${paceCell(input.callsPacePct, input.actualCalls, input.expectedCalls, `Calls (target ${input.dailyCallTarget ?? '—'}/day)`)}
      ${paceCell(input.bookingsPacePct, input.actualBooked, input.expectedBookings, `Bookings (target ${input.dailyBookingTarget ?? '—'}/day)`)}
    </tbody>
  </table>
  <p>Please take 2 minutes to tell us what is blocking you so we can coach you before the week ends:</p>
  <p><a href="${escapeHtml(input.formUrl)}" style="display:inline-block;padding:12px 18px;background:#4e9ae8;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Open check-in form</a></p>
  <p style="font-size:13px;color:#5c7594">After you submit, jump back into the phone workspace. Leadership reviews these before the recruiting meeting.</p>
</body></html>`;
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
    const cronSecret = Deno.env.get('PERFORMANCE_CHECKIN_CRON_SECRET')?.trim();
    const headerSecret = req.headers.get('x-cron-secret')?.trim();
    if (!cronSecret) {
      return new Response(
        JSON.stringify({ error: 'Server misconfiguration', detail: 'PERFORMANCE_CHECKIN_CRON_SECRET not set' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (headerSecret !== cronSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const automationEnabled =
      MID_WEEK_COACHING_ENABLED &&
      (Deno.env.get('PERFORMANCE_CHECKIN_AUTOMATION_ENABLED') ?? 'false') === 'true';
    const url = new URL(req.url);
    const dryRun = url.searchParams.get('dry_run') === 'true' || !automationEnabled;
    const forceRun = url.searchParams.get('force') === 'true';

    if (!MID_WEEK_COACHING_ENABLED) {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: 'Mid-week coaching disabled in code' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const now = new Date();
    if (!forceRun && !isMidWeekDay(now)) {
      return new Response(
        JSON.stringify({
          ok: true,
          skipped: true,
          reason: 'Not mid-week (Mon/Tue Toronto)',
          automationEnabled,
          dryRun,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const todayYmd = torontoYmd(now);
    const week = fridayWeekBounds(todayYmd);
    const days = elapsedDays(week.since, todayYmd);
    const weekStartIso = `${week.since}T00:00:00.000-04:00`;
    const weekEndIso = `${week.until}T23:59:59.999-04:00`;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRole);

    const [{ data: profiles }, { data: settingsRows }, { data: callRows }, { data: existingInvites }] = await Promise.all([
      admin
        .from('user_profiles')
        .select('user_id, email, full_name, role')
        .in('role', ['recruiter', 'leadership', 'webinar']),
      admin.from('pipeline_user_call_settings').select('user_id, daily_upload_target, daily_webinar_booking_target'),
      admin
        .from('pipeline_call_records')
        .select('recruiter_user_id, disposition')
        .gte('called_at', weekStartIso)
        .lte('called_at', weekEndIso)
        .limit(20000),
      admin
        .from('recruiter_performance_check_in_invites')
        .select('user_id, email_sent_at')
        .eq('week_since', week.since),
    ]);

    const settingsByUser = new Map<string, SettingsRow>();
    for (const row of (settingsRows || []) as SettingsRow[]) {
      settingsByUser.set(row.user_id, row);
    }

    const alreadyEmailed = new Set(
      ((existingInvites || []) as Array<{ user_id: string; email_sent_at: string | null }>)
        .filter((row) => row.email_sent_at)
        .map((row) => row.user_id),
    );

    const callsByUser = new Map<string, { calls: number; booked: number }>();
    for (const row of (callRows || []) as CallRow[]) {
      const uid = row.recruiter_user_id;
      if (!uid) continue;
      const agg = callsByUser.get(uid) || { calls: 0, booked: 0 };
      agg.calls += 1;
      if (String(row.disposition || '').trim().toLowerCase() === 'booked') agg.booked += 1;
      callsByUser.set(uid, agg);
    }

    const transport = dryRun ? null : getTransport();
    const candidates: Array<Record<string, unknown>> = [];
    let emailsSent = 0;

    for (const profile of (profiles || []) as ProfileRow[]) {
      const email = String(profile.email || '').trim().toLowerCase();
      if (!email || email.startsWith('demo-')) continue;

      const settings = settingsByUser.get(profile.user_id);
      const dailyCallTarget =
        typeof settings?.daily_upload_target === 'number' ? settings.daily_upload_target : null;
      const dailyBookingTarget =
        typeof settings?.daily_webinar_booking_target === 'number' ? settings.daily_webinar_booking_target : null;
      if (!dailyCallTarget && !dailyBookingTarget) continue;

      const agg = callsByUser.get(profile.user_id) || { calls: 0, booked: 0 };
      const pace = computePace({
        dailyCallTarget,
        dailyBookingTarget,
        actualCalls: agg.calls,
        actualBooked: agg.booked,
        elapsedDays: days,
      });
      if (!pace.belowThreshold) continue;
      if (!dryRun && alreadyEmailed.has(profile.user_id)) continue;

      const invitePayload = {
        user_id: profile.user_id,
        submitter_email: email,
        submitter_name: profile.full_name,
        week_since: week.since,
        week_until: week.until,
        daily_call_target: dailyCallTarget,
        daily_booking_target: dailyBookingTarget,
        elapsed_days: days,
        actual_calls: agg.calls,
        actual_booked: agg.booked,
        expected_calls: pace.expectedCalls,
        expected_bookings: pace.expectedBookings,
        calls_pace_pct: pace.callsPacePct,
        bookings_pace_pct: pace.bookingsPacePct,
        below_threshold: true,
        email_sent_at: dryRun ? null : new Date().toISOString(),
      };

      const { data: invite, error: inviteErr } = await admin
        .from('recruiter_performance_check_in_invites')
        .upsert(invitePayload, { onConflict: 'user_id,week_since' })
        .select('invite_token, email_sent_at')
        .single();
      if (inviteErr) {
        console.error('invite upsert failed', profile.user_id, inviteErr.message);
        continue;
      }

      const formUrl = `${APP_URL}/performance-check-in?token=${invite.invite_token}`;
      const firstName = String(profile.full_name || email).split(/\s+/)[0] || 'there';

      if (!dryRun && transport) {
        const fromEmail = Deno.env.get('SMTP_FROM')?.trim() || Deno.env.get('SMTP_USERNAME')?.trim() || '';
        const subject = 'Mid-week check-in — quick coaching form';
        try {
          await transport.sendMail({
            from: fromEmail,
            to: email,
            subject,
            html: buildEmailHtml({
              firstName,
              weekLabel: `${week.since} → ${week.until}`,
              callsPacePct: pace.callsPacePct,
              bookingsPacePct: pace.bookingsPacePct,
              actualCalls: agg.calls,
              actualBooked: agg.booked,
              expectedCalls: pace.expectedCalls,
              expectedBookings: pace.expectedBookings,
              dailyCallTarget,
              dailyBookingTarget,
              elapsedDays: days,
              formUrl,
            }),
          });
          await insertEmailSendLog(admin, {
            source: 'performance-check-in-reminder',
            trigger_label: 'mid_week_performance_checkin',
            from_email: fromEmail,
            to_email: email,
            subject,
            status: 'sent',
            metadata: {
              category: 'mid_week_coaching',
              send_mode: 'auto',
              user_id: profile.user_id,
              week_since: week.since,
              calls_pace_pct: pace.callsPacePct,
              bookings_pace_pct: pace.bookingsPacePct,
              form_url: formUrl,
            },
          });
          emailsSent += 1;
        } catch (mailErr) {
          await insertEmailSendLog(admin, {
            source: 'performance-check-in-reminder',
            trigger_label: 'mid_week_performance_checkin',
            from_email: fromEmail,
            to_email: email,
            subject,
            status: 'failed',
            error_message: mailErr instanceof Error ? mailErr.message : String(mailErr),
            metadata: { category: 'mid_week_coaching', user_id: profile.user_id, week_since: week.since },
          });
        }
      }

      candidates.push({
        userId: profile.user_id,
        email,
        name: profile.full_name,
        callsPacePct: pace.callsPacePct,
        bookingsPacePct: pace.bookingsPacePct,
        formUrl,
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        automationEnabled,
        dryRun,
        week,
        elapsedDays: days,
        belowThresholdCount: candidates.length,
        emailsSent,
        candidates,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('performance-check-in-reminder:', e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
