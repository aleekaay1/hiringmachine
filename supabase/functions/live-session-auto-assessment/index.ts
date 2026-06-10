/**
 * Cron: ~60 min after Wednesday live session (11:30 AM ET → run ~12:30 ET).
 * Re-fetches Zoom attendance, updates matches, sends leadership assessment emails (existing template).
 *
 * Invoke: POST with header x-cron-secret: <LIVE_SESSION_AUTO_CRON_SECRET>
 * Optional: ?dry_run=true | ?session_date=2026-06-10
 * Deploy: supabase functions deploy live-session-auto-assessment
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  findSessionsDueForAutoRun,
  runLiveSessionPostMeeting,
} from '../_shared/liveSessionPostMeeting.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info, x-cron-secret',
};

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
    const cronSecret = Deno.env.get('LIVE_SESSION_AUTO_CRON_SECRET')?.trim();
    const headerSecret = req.headers.get('x-cron-secret')?.trim();
    if (!cronSecret) {
      return new Response(
        JSON.stringify({ error: 'Server misconfiguration', detail: 'LIVE_SESSION_AUTO_CRON_SECRET not set' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    if (headerSecret !== cronSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    const dryRun = url.searchParams.get('dry_run') === 'true';
    const forcedDate = url.searchParams.get('session_date')?.trim() || '';

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRole);

    const sessionDates = forcedDate ? [forcedDate] : await findSessionsDueForAutoRun(admin);
    if (dryRun) {
      return new Response(
        JSON.stringify({ ok: true, dry_run: true, session_dates: sessionDates }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const results = [];
    for (const sessionDate of sessionDates) {
      try {
        const result = await runLiveSessionPostMeeting(admin, sessionDate, {
          sendAssessments: true,
          mode: 'auto',
        });
        results.push(result);
      } catch (e) {
        results.push({
          session_date: sessionDate,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed: results.length, results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error('live-session-auto-assessment:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Run failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
