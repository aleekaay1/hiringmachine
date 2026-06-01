// Serves a downloadable .ics for the Live Online Career Session (post–check-in email "Add to Calendar").
// Deploy: supabase functions deploy live-session-calendar
// Query: ?sessionDate=YYYY-MM-DD (optional; default = next upcoming occurrence)

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildIcsContent } from '../_shared/calendarInvite.ts';
import { ZOOM_MEETING_URL } from '../_shared/hiringUrls.ts';
import {
  fetchNextUpcomingOccurrence,
  fetchOccurrenceBySessionDate,
  resolveLiveSessionCalendarFromOccurrence,
} from '../_shared/liveSessionOccurrenceCalendar.ts';

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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!serviceRole) {
      return new Response('Server misconfiguration', { status: 500, headers: corsHeaders });
    }

    const url = new URL(req.url);
    const sessionDateParam = url.searchParams.get('sessionDate')?.trim() || '';

    const admin = createClient(supabaseUrl, serviceRole);
    const occurrence = /^\d{4}-\d{2}-\d{2}$/.test(sessionDateParam)
      ? await fetchOccurrenceBySessionDate(admin, sessionDateParam)
      : await fetchNextUpcomingOccurrence(admin);

    const event = resolveLiveSessionCalendarFromOccurrence(
      {
        PUBLIC_LIVE_SESSION_START_ISO: Deno.env.get('PUBLIC_LIVE_SESSION_START_ISO') ?? undefined,
        PUBLIC_LIVE_SESSION_END_ISO: Deno.env.get('PUBLIC_LIVE_SESSION_END_ISO') ?? undefined,
        PUBLIC_LIVE_SESSION_DISPLAY_DATE: Deno.env.get('PUBLIC_LIVE_SESSION_DISPLAY_DATE') ?? undefined,
        PUBLIC_LIVE_SESSION_DISPLAY_TIME: Deno.env.get('PUBLIC_LIVE_SESSION_DISPLAY_TIME') ?? undefined,
        PUBLIC_LIVE_SESSION_CALENDAR_TITLE: Deno.env.get('PUBLIC_LIVE_SESSION_CALENDAR_TITLE') ?? undefined,
        PUBLIC_LIVE_SESSION_CALENDAR_DESCRIPTION:
          Deno.env.get('PUBLIC_LIVE_SESSION_CALENDAR_DESCRIPTION') ?? undefined,
        PUBLIC_LIVE_SESSION_CALENDAR_LOCATION: Deno.env.get('PUBLIC_LIVE_SESSION_CALENDAR_LOCATION') ?? undefined,
      },
      ZOOM_MEETING_URL,
      occurrence,
    );

    if (!event) {
      return new Response('No live session scheduled', {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    const icsUid = event.sessionDate
      ? `live-session-${event.sessionDate}@paz-organization`
      : 'live-session@paz-organization';
    const ics = buildIcsContent(event, icsUid);
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
