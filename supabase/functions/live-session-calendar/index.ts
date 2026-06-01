// Serves a downloadable .ics for the Live Online Career Session (post–check-in email "Add to Calendar").
// Deploy: supabase functions deploy live-session-calendar
// Secrets: PUBLIC_LIVE_SESSION_START_ISO, PUBLIC_LIVE_SESSION_END_ISO (required for a valid invite)

import { buildIcsContent, resolveLiveSessionCalendar } from '../_shared/calendarInvite.ts';
import { ZOOM_MEETING_URL } from '../_shared/hiringUrls.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, apikey, x-client-info',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const event = resolveLiveSessionCalendar(
      {
        PUBLIC_LIVE_SESSION_START_ISO: Deno.env.get('PUBLIC_LIVE_SESSION_START_ISO') ?? undefined,
        PUBLIC_LIVE_SESSION_END_ISO: Deno.env.get('PUBLIC_LIVE_SESSION_END_ISO') ?? undefined,
        PUBLIC_LIVE_SESSION_DISPLAY_DATE: Deno.env.get('PUBLIC_LIVE_SESSION_DISPLAY_DATE') ?? undefined,
        PUBLIC_LIVE_SESSION_DISPLAY_TIME: Deno.env.get('PUBLIC_LIVE_SESSION_DISPLAY_TIME') ?? undefined,
        PUBLIC_LIVE_SESSION_CALENDAR_TITLE: Deno.env.get('PUBLIC_LIVE_SESSION_CALENDAR_TITLE') ?? undefined,
        PUBLIC_LIVE_SESSION_CALENDAR_DESCRIPTION: Deno.env.get('PUBLIC_LIVE_SESSION_CALENDAR_DESCRIPTION') ?? undefined,
        PUBLIC_LIVE_SESSION_CALENDAR_LOCATION: Deno.env.get('PUBLIC_LIVE_SESSION_CALENDAR_LOCATION') ?? undefined,
      },
      ZOOM_MEETING_URL,
    );

    const ics = buildIcsContent(event);
    return new Response(ics, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="live-online-career-session.ics"',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (e) {
    console.error('live-session-calendar:', e);
    return new Response('Failed to build calendar file', {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
});
