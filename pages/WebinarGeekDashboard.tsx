import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import { fetchWebinarGeekDashboard, syncWebinarGeekCandidates } from '../services/webinarGeekIntegrations';
import { ChevronLeft, ChevronRight, Download, MessageSquare, RefreshCw, Search, UserCircle2, X } from 'lucide-react';
import {
  buildCandidateNameProfiles,
  callerDisplayFromRow,
  candidateDisplayNameFromRow,
  fileTagNameFromRow,
  getInviterAttributionFromRow,
  profileInitials,
  rowMatchesNameKey,
} from '../services/webinarGeekInviters';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import type { AdminNote } from '../types';
import {
  fetchWebinarGeekNotesForIds,
  insertWebinarGeekHrNote,
  latestWebinarGeekNote,
} from '../services/webinarGeekHrNotes';

type AnyRow = Record<string, unknown>;
type DashboardData = Record<string, unknown>;
type BroadcastSchedule = {
  id: string;
  dateMs: number;
  title: string;
  webinarTitle: string;
  status: string;
  subscriptionsCount: number | null;
};
type ScopeMode = 'month' | 'week' | 'day';

const FULL_WATCH_SECONDS = 45 * 60;
const HALF_WATCH_SECONDS = Math.floor(47 * 60 * 0.5);

function asUnixMs(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? n : n * 1000;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Toronto calendar YYYY-MM-DD for "today" (wall clock). */
function torontoYmdFromDate(d = new Date()): string {
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

function torontoMonthStartToday(): string {
  const t = torontoYmdFromDate();
  return `${t.slice(0, 7)}-01`;
}

function shiftMonthFirstYmd(firstYmd: string, delta: number): string {
  const [y, m] = firstYmd.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
}

function monthBoundsFromFirstYmd(firstYmd: string): { since: string; until: string; title: string } {
  const [y, m] = firstYmd.split('-').map(Number);
  const lastD = new Date(y, m, 0).getDate();
  const since = `${y}-${pad2(m)}-01`;
  const until = `${y}-${pad2(m)}-${pad2(lastD)}`;
  const title = new Date(y, m - 1, 7).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  return { since, until, title };
}

function ymdToLocalDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function localDateToYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function shiftYmdDays(ymd: string, deltaDays: number): string {
  const d = ymdToLocalDate(ymd);
  d.setDate(d.getDate() + deltaDays);
  return localDateToYmd(d);
}

/** Friday -> Thursday week boundaries for a given YMD (Toronto wall date). */
function fridayWeekBoundsFromYmd(ymd: string): { since: string; until: string; title: string } {
  const d = ymdToLocalDate(ymd);
  const dow = d.getDay(); // Sun=0..Sat=6
  const offsetToFriday = (dow + 2) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - offsetToFriday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const since = localDateToYmd(start);
  const until = localDateToYmd(end);
  const title = `${ymdToShortLabel(since)} → ${ymdToShortLabel(until)}`;
  return { since, until, title };
}

/** One API pull: April 15 (Toronto season) through end of next calendar year — all months filter client-side. */
function fetchWindowBoundsWide(): { since: string; until: string; label: string } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const y = Number(p.find((x) => x.type === 'year')?.value ?? '2026');
  const m = Number(p.find((x) => x.type === 'month')?.value ?? '1');
  const d = Number(p.find((x) => x.type === 'day')?.value ?? '1');
  const seasonYear = m > 4 || (m === 4 && d >= 15) ? y : y - 1;
  const since = `${seasonYear}-04-15`;
  const until = `${seasonYear + 1}-12-31`;
  return { since, until, label: `${since} → ${until}` };
}

function pct(part: number, whole: number): string {
  if (!whole || whole <= 0) return '0';
  return `${Math.round((100 * part) / whole)}%`;
}

function eventMsToTorontoYmd(ms: number): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(ms));
  const y = p.find((x) => x.type === 'year')?.value ?? '1970';
  const mo = p.find((x) => x.type === 'month')?.value ?? '01';
  const da = p.find((x) => x.type === 'day')?.value ?? '01';
  return `${y}-${mo}-${da}`;
}

function fmtDateKey(row: AnyRow): string {
  const ms =
    asUnixMs((row.broadcast as AnyRow | undefined)?.date) ??
    asUnixMs(row.created_at) ??
    asUnixMs(row.watched_true_set_at);
  if (!ms) return 'unknown';
  return eventMsToTorontoYmd(ms);
}

/** Whole minutes from watch_duration seconds (0 if none). */
function watchMinutes(value: unknown): number {
  const sec = Number(value);
  if (!Number.isFinite(sec) || sec <= 0) return 0;
  return Math.round(sec / 60);
}

function shortCalendarDayLabel(viewYear: number, viewMonth0: number, day: number): string {
  return new Date(viewYear, viewMonth0, day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  });
}

function ymdToShortLabel(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  return shortCalendarDayLabel(y, m - 1, d);
}

function watchSecondsFromRow(row: AnyRow): number {
  const sec = Number(row.watch_duration || 0);
  return Number.isFinite(sec) && sec > 0 ? sec : 0;
}

/** CSV / Excel: no em-dash mojibake — use 0 when missing. */
function csvScalar(value: string | number): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  const t = value
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u2212/g, '-')
    .trim();
  if (!t || t === '-' || t === '—') return '0';
  return t;
}

function toCsvCell(value: unknown): string {
  const s = csvScalar(String(value ?? ''));
  return `"${s.replace(/"/g, '""')}"`;
}

function watchBucket(seconds: number): 'full' | 'half' | 'under_half' | 'no_watch' {
  if (seconds >= FULL_WATCH_SECONDS) return 'full';
  if (seconds >= HALF_WATCH_SECONDS) return 'half';
  if (seconds > 0) return 'under_half';
  return 'no_watch';
}

function watchRowToneClass(seconds: number): string {
  const b = watchBucket(seconds);
  if (b === 'full') return 'bg-emerald-50 hover:bg-emerald-100/90';
  if (b === 'half') return 'bg-sky-50 hover:bg-sky-100/90';
  return 'bg-rose-50 hover:bg-rose-100/90';
}

/** Table filter: matches legend rows (full / half+ / little·none). */
type WatchToneFilter = 'full' | 'half' | 'low';

function rowMatchesWatchToneFilter(row: AnyRow, filter: WatchToneFilter): boolean {
  const sec = Number(row.watch_duration || 0);
  const b = watchBucket(sec);
  if (filter === 'full') return b === 'full';
  if (filter === 'half') return b === 'half';
  return b === 'under_half' || b === 'no_watch';
}

function normalizeSubscriptions(data: DashboardData | null): AnyRow[] {
  const payload = data?.subscriptions as Record<string, unknown> | undefined;
  const rows = payload?.subscriptions;
  return Array.isArray(rows) ? (rows as AnyRow[]) : [];
}

function normalizeBroadcastSchedules(data: DashboardData | null): BroadcastSchedule[] {
  const payload = data?.broadcasts as Record<string, unknown> | undefined;
  const rows = payload?.broadcasts;
  if (!Array.isArray(rows)) return [];
  const mapped: BroadcastSchedule[] = [];
  for (const raw of rows as AnyRow[]) {
    const dateMs = asUnixMs(raw.date);
    if (!dateMs) continue;
    const title =
      String(raw.title ?? raw.name ?? (raw.webinar as AnyRow | undefined)?.title ?? `Broadcast ${String(raw.id ?? '')}`).trim() || 'Broadcast';
    const webinarTitle = String((raw.webinar as AnyRow | undefined)?.title ?? '').trim();
    const status = String(raw.status ?? '').trim();
    const subscriptionsCountNum = Number(raw.subscriptions_count);
    mapped.push({
      id: String(raw.id ?? ''),
      dateMs,
      title,
      webinarTitle: webinarTitle || title,
      status: status || 'scheduled',
      subscriptionsCount: Number.isFinite(subscriptionsCountNum) ? subscriptionsCountNum : null,
    });
  }
  return mapped;
}

function getPhoneDisplay(row: AnyRow): string {
  const phone = String(row.phone ?? row.telephone ?? row.mobile ?? '').trim();
  return phone || '0';
}

function subscriptionKey(row: AnyRow): string {
  return String(row.id ?? '').trim();
}

const WebinarGeekDashboard: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** null = never fetched; array = last fetch result (client-side only until next fetch). */
  const [subscriptionCache, setSubscriptionCache] = useState<AnyRow[] | null>(null);
  const [broadcastCache, setBroadcastCache] = useState<BroadcastSchedule[]>([]);
  const [lastFetchAt, setLastFetchAt] = useState<string | null>(null);
  const [lastFetchRange, setLastFetchRange] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  /** First day of the month being viewed (YYYY-MM-01), Toronto wall month via local month arithmetic. */
  const [monthAnchorYmd, setMonthAnchorYmd] = useState(torontoMonthStartToday);
  /** When set, table shows only that Toronto calendar day; null = whole month window. */
  const [selectedDayYmd, setSelectedDayYmd] = useState<string | null>(null);
  const [scopeMode, setScopeMode] = useState<ScopeMode>('month');
  const [weekAnchorYmd, setWeekAnchorYmd] = useState(() => torontoYmdFromDate());
  /** Click legend to filter table; click same legend again to clear (null). */
  const [watchToneFilter, setWatchToneFilter] = useState<WatchToneFilter | null>(null);
  /** null = all; otherwise filter by normalized name from custom_field (after cooper_/rms_). */
  const [selectedNameKey, setSelectedNameKey] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<AnyRow | null>(null);
  const [wgNotesBySubId, setWgNotesBySubId] = useState<Record<string, AdminNote[]>>({});
  const [wgNotesLoading, setWgNotesLoading] = useState(false);
  const [wgNotesError, setWgNotesError] = useState<string | null>(null);
  const [newWgNote, setNewWgNote] = useState('');
  const [savingWgNote, setSavingWgNote] = useState(false);
  const [showAllSchedules, setShowAllSchedules] = useState(false);
  const [expandedScheduleKey, setExpandedScheduleKey] = useState<string | null>(null);
  const monthWindow = useMemo(() => monthBoundsFromFirstYmd(monthAnchorYmd), [monthAnchorYmd]);

  /** Rows whose event date falls in the calendar month being viewed (no API). */
  const rowsInViewMonth = useMemo(() => {
    if (!subscriptionCache) return [];
    const [vy, vm] = monthAnchorYmd.split('-').map(Number);
    const start = `${vy}-${pad2(vm)}-01`;
    const lastD = new Date(vy, vm, 0).getDate();
    const end = `${vy}-${pad2(vm)}-${pad2(lastD)}`;
    return subscriptionCache.filter((row) => {
      const k = fmtDateKey(row);
      if (k === 'unknown') return false;
      return k >= start && k <= end;
    });
  }, [subscriptionCache, monthAnchorYmd]);

  const weekWindow = useMemo(() => fridayWeekBoundsFromYmd(weekAnchorYmd), [weekAnchorYmd]);

  const rowsInViewWeek = useMemo(() => {
    if (!subscriptionCache) return [];
    return subscriptionCache.filter((row) => {
      const k = fmtDateKey(row);
      if (k === 'unknown') return false;
      return k >= weekWindow.since && k <= weekWindow.until;
    });
  }, [subscriptionCache, weekWindow.since, weekWindow.until]);

  const schedulesInViewMonth = useMemo(() => {
    const nowMs = Date.now();
    const [vy, vm] = monthAnchorYmd.split('-').map(Number);
    const start = Date.UTC(vy, vm - 1, 1, 0, 0, 0, 0);
    const end = Date.UTC(vy, vm, 0, 23, 59, 59, 999);
    return broadcastCache
      .filter((b) => b.dateMs >= nowMs && b.dateMs >= start && b.dateMs <= end)
      .sort((a, b) => a.dateMs - b.dateMs);
  }, [broadcastCache, monthAnchorYmd]);

  useEffect(() => {
    setShowAllSchedules(false);
    setExpandedScheduleKey(null);
  }, [monthAnchorYmd]);

  const rowsForScope = useMemo(() => {
    if (scopeMode === 'week') return rowsInViewWeek;
    if (scopeMode === 'day') {
      if (!selectedDayYmd) return [];
      return rowsInViewMonth.filter((r) => fmtDateKey(r) === selectedDayYmd);
    }
    return rowsInViewMonth;
  }, [scopeMode, rowsInViewWeek, rowsInViewMonth, selectedDayYmd]);

  const nameProfiles = useMemo(
    () => buildCandidateNameProfiles(rowsForScope, watchSecondsFromRow),
    [rowsForScope],
  );

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rowsForScope.filter((row) => {
      if (selectedNameKey) {
        if (!rowMatchesNameKey(row, selectedNameKey)) return false;
      }
      if (watchToneFilter && !rowMatchesWatchToneFilter(row, watchToneFilter)) return false;
      if (!q) return true;
      const name = candidateDisplayNameFromRow(row).toLowerCase();
      const wgName = `${String(row.firstname ?? '').trim()} ${String(row.surname ?? '').trim()}`.toLowerCase();
      const fileName = inviteeLabelFromRow(row).toLowerCase();
      const emailText = String(row.email ?? '').toLowerCase();
      const phoneText = getPhoneDisplay(row).toLowerCase();
      const fileTag = fileTagNameFromRow(row).toLowerCase();
      const caller = callerDisplayFromRow(row).toLowerCase();
      const rawField = String(getInviterAttributionFromRow(row).raw ?? '').toLowerCase();
      const sid = subscriptionKey(row);
      const notesHay = (wgNotesBySubId[sid] ?? [])
        .map((n) => `${n.text} ${n.authorEmail ?? ''}`)
        .join(' ')
        .toLowerCase();
      return (
        name.includes(q)
        || wgName.includes(q)
        || fileName.includes(q)
        || emailText.includes(q)
        || phoneText.includes(q)
        || fileTag.includes(q)
        || caller.includes(q)
        || rawField.includes(q)
        || notesHay.includes(q)
      );
    });
  }, [rowsForScope, searchQuery, watchToneFilter, wgNotesBySubId, selectedNameKey]);

  const toggleWatchToneFilter = useCallback((tone: WatchToneFilter) => {
    setWatchToneFilter((prev) => (prev === tone ? null : tone));
  }, []);

  useEffect(() => {
    if (!subscriptionCache?.length) {
      setWgNotesBySubId({});
      setWgNotesError(null);
      return;
    }
    const ids = [...new Set(rowsInViewMonth.map((r) => subscriptionKey(r)).filter(Boolean))];
    if (ids.length === 0) {
      setWgNotesBySubId({});
      return;
    }
    let cancelled = false;
    setWgNotesLoading(true);
    setWgNotesError(null);
    void (async () => {
      try {
        const map = await fetchWebinarGeekNotesForIds(ids);
        if (cancelled) return;
        const next: Record<string, AdminNote[]> = {};
        map.forEach((notes, k) => {
          next[k] = notes;
        });
        setWgNotesBySubId(next);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setWgNotesError(
            /relation|does not exist|schema cache|PGRST205/i.test(msg)
              ? 'HR notes table is not deployed. Run migration 20260506_webinar_geek_hr_notes.sql on this Supabase project, then refresh.'
              : msg
          );
          setWgNotesBySubId({});
        }
      } finally {
        if (!cancelled) setWgNotesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subscriptionCache, rowsInViewMonth]);

  const handleAddWgHrNote = useCallback(async () => {
    const row = selectedRow;
    const text = newWgNote.trim();
    if (!row || !text) return;
    const sid = subscriptionKey(row);
    if (!sid) return;
    setSavingWgNote(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const authorLabel =
        String(user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || '').trim() || undefined;
      const note = await insertWebinarGeekHrNote(sid, text, authorLabel);
      setWgNotesBySubId((prev) => {
        const prevList = prev[sid] ?? [];
        const merged = [...prevList, note].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        return { ...prev, [sid]: merged };
      });
      setNewWgNote('');
    } catch (err) {
      console.error(err);
      window.alert(err instanceof Error ? err.message : 'Could not save note.');
    } finally {
      setSavingWgNote(false);
    }
  }, [selectedRow, newWgNote]);

  useEffect(() => {
    setNewWgNote('');
  }, [selectedRow?.id]);

  const monthOverview = useMemo(() => {
    const rows = rowsInViewMonth;
    const n = rows.length;
    let watched = 0;
    let full = 0;
    let half = 0;
    let low = 0;
    for (const r of rows) {
      if (r.watched === true) watched += 1;
      const sec = Number(r.watch_duration || 0);
      const b = watchBucket(sec);
      if (b === 'full') full += 1;
      else if (b === 'half') half += 1;
      else low += 1;
    }
    return { n, watched, full, half, low, ymd: null as string | null };
  }, [rowsInViewMonth]);

  const selectedDayOverview = useMemo(() => {
    if (!selectedDayYmd) return null;
    const rows = rowsInViewMonth.filter((r) => fmtDateKey(r) === selectedDayYmd);
    const n = rows.length;
    let watched = 0;
    let full = 0;
    let half = 0;
    let low = 0;
    for (const r of rows) {
      if (r.watched === true) watched += 1;
      const sec = Number(r.watch_duration || 0);
      const b = watchBucket(sec);
      if (b === 'full') full += 1;
      else if (b === 'half') half += 1;
      else low += 1;
    }
    return { n, watched, full, half, low, ymd: selectedDayYmd };
  }, [rowsInViewMonth, selectedDayYmd]);

  const selectedWeekOverview = useMemo(() => {
    const rows = rowsInViewWeek;
    const n = rows.length;
    let watched = 0;
    let full = 0;
    let half = 0;
    let low = 0;
    for (const r of rows) {
      if (r.watched === true) watched += 1;
      const sec = Number(r.watch_duration || 0);
      const b = watchBucket(sec);
      if (b === 'full') full += 1;
      else if (b === 'half') half += 1;
      else low += 1;
    }
    return { n, watched, full, half, low, ymd: null as string | null };
  }, [rowsInViewWeek]);

  const overviewForUi = scopeMode === 'day'
    ? (selectedDayOverview ?? monthOverview)
    : (scopeMode === 'week' ? selectedWeekOverview : monthOverview);

  const statTiles = useMemo(() => {
    const { n, watched, full, half, low } = overviewForUi;
    const fullOfWatched = watched > 0 ? Math.round((100 * full) / watched) : 0;
    return [
      { k: 'Registrations', v: String(n), sub: 'in scope' },
      { k: 'Watched', v: pct(watched, n), sub: `${watched} marked yes` },
      { k: 'Full watch', v: pct(full, n), sub: `${full} rows` },
      { k: 'Half+', v: pct(half, n), sub: `${half} rows` },
      { k: 'Little / none', v: pct(low, n), sub: `${low} rows` },
      { k: 'Full of watched', v: `${fullOfWatched}%`, sub: watched ? `${full} / ${watched}` : '—' },
    ];
  }, [overviewForUi]);

  const [viewYear, viewMonth0] = useMemo(() => {
    const [y, m] = monthAnchorYmd.split('-').map(Number);
    return [y, m - 1] as const;
  }, [monthAnchorYmd]);

  const scopeTitle = useMemo(() => {
    if (scopeMode === 'week') return `Week · ${weekWindow.title}`;
    if (scopeMode === 'day' && selectedDayYmd) return `Day · ${ymdToShortLabel(selectedDayYmd)}`;
    return `Month · ${monthWindow.title}`;
  }, [scopeMode, weekWindow.title, selectedDayYmd, monthWindow.title]);

  const calendarCells = useMemo(() => {
    const firstDow = new Date(viewYear, viewMonth0, 1).getDay();
    const lastDay = new Date(viewYear, viewMonth0 + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= lastDay; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [viewYear, viewMonth0]);

  const dayCounts = useMemo(() => {
    const map = new Map<string, { invited: number; watched: number; schedules: number }>();
    for (const row of rowsInViewMonth) {
      const key = fmtDateKey(row);
      if (key === 'unknown') continue;
      if (!map.has(key)) map.set(key, { invited: 0, watched: 0, schedules: 0 });
      const e = map.get(key)!;
      e.invited += 1;
      if (row.watched === true) e.watched += 1;
    }
    for (const b of schedulesInViewMonth) {
      const key = eventMsToTorontoYmd(b.dateMs);
      if (!map.has(key)) map.set(key, { invited: 0, watched: 0, schedules: 0 });
      map.get(key)!.schedules += 1;
    }
    return map;
  }, [rowsInViewMonth, schedulesInViewMonth]);

  const getFreshAccessToken = useCallback(async (): Promise<string | null> => {
    const { data: s } = await supabase.auth.getSession();
    const session = s.session;
    if (!session) return null;
    const expiresAtMs = (session.expires_at || 0) * 1000;
    if (expiresAtMs > Date.now() + 60_000 && session.access_token) return session.access_token;
    const { data: refreshed, error: refreshErr } = await supabase.auth.refreshSession();
    if (refreshErr) return null;
    return refreshed.session?.access_token ?? null;
  }, []);

  const withAuthRetry = useCallback(
    async <T,>(run: (token: string) => Promise<T | null>): Promise<T | null> => {
      const firstToken = await getFreshAccessToken();
      if (!firstToken) return null;
      const first = await run(firstToken);
      if (first !== null) return first;
      const { data: refreshed } = await supabase.auth.refreshSession();
      const retryToken = refreshed.session?.access_token;
      if (!retryToken) return null;
      return run(retryToken);
    },
    [getFreshAccessToken]
  );

  const fetchDashboardData = useCallback(async () => {
    setError(null);
    setLoading(true);
    const { since, until, label } = fetchWindowBoundsWide();
    const result = await withAuthRetry(async (token) => {
      const r = await fetchWebinarGeekDashboard(token, {
        perPage: 250,
        since,
        until,
        includeCatalog: true,
        maxPages: 36,
      });
      if (!r.ok && r.error.toLowerCase().includes('unauthorized')) return null;
      return r;
    });
    setLoading(false);
    if (!result) {
      setError('Session unauthorized. Sign out and sign in again.');
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const rows = normalizeSubscriptions(result.data);
    const schedules = normalizeBroadcastSchedules(result.data);
    setSubscriptionCache(rows);
    setBroadcastCache(schedules);
    setLastFetchAt(new Date().toISOString());
    setLastFetchRange(label);
  }, [withAuthRetry]);

  const runSync = useCallback(async () => {
    setError(null);
    setSyncLoading(true);
    const { since, until } = fetchWindowBoundsWide();
    const result = await withAuthRetry(async (token) => {
      const r = await syncWebinarGeekCandidates(token, {
        perPage: 250,
        since,
        until,
        maxPages: 36,
      });
      if (!r.ok && r.error.toLowerCase().includes('unauthorized')) return null;
      return r;
    });
    setSyncLoading(false);
    if (!result) {
      setError('Session unauthorized for sync.');
      return;
    }
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await fetchDashboardData();
  }, [withAuthRetry, fetchDashboardData]);

  const handleCsvExport = useCallback(() => {
    const headers = [
      'subscription_id',
      'candidate_name',
      'registration_first_name',
      'registration_last_name',
      'email',
      'phone',
      'name_from_file',
      'caller',
      'registration',
      'watch_minutes',
      'watched',
    ];
    const rows = filteredRows.map((row) => {
      const candidateName = csvScalar(candidateDisplayNameFromRow(row) || '');
      const first = csvScalar(String(row.firstname ?? '').trim());
      const last = csvScalar(String(row.surname ?? '').trim());
      const email = csvScalar(String(row.email ?? '').trim());
      const phone = csvScalar(getPhoneDisplay(row));
      const fileTag = csvScalar(fileTagNameFromRow(row) || '0');
      const caller = csvScalar(callerDisplayFromRow(row) || '0');
      const regMs = asUnixMs(row.created_at);
      const registration =
        regMs != null ? new Date(regMs).toISOString().slice(0, 16).replace('T', ' ') : '0';
      const mins = watchMinutes(row.watch_duration);
      const watched = row.watched === true ? 'Yes' : 'No';
      return [
        String(row.id ?? '0'),
        candidateName,
        first,
        last,
        email,
        phone,
        fileTag,
        caller,
        registration,
        String(mins),
        watched,
      ];
    });
    const line = (cells: string[]) => cells.map(toCsvCell).join(',');
    const csvBody = [line(headers), ...rows.map((r) => line(r))].join('\r\n');
    const csv = `\uFEFF${csvBody}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `webinar-clean-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredRows]);

  useEffect(() => {
    const check = async () => {
      const { data: s } = await supabase.auth.getSession();
      if (s.session) setIsAuthenticated(true);
    };
    void check();
  }, []);

  useEffect(() => {
    setSelectedDayYmd(null);
  }, [monthAnchorYmd]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setAuthError('Invalid email or password.');
      return;
    }
    setIsAuthenticated(true);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f7fbff] to-[#eef6ff] flex items-center justify-center p-4">
        <div className="bg-white border border-[#d9e9fb] p-8 rounded-[24px] shadow w-full max-w-sm">
          <h2 className="text-xl font-bold text-[#0B1B34] mb-1 text-center">WebinarGeek dashboard</h2>
          <p className="text-sm text-[#6f7b8d] text-center mb-6">Sign in with your admin account</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-[#cfe3f9]" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-4 py-2.5 rounded-xl border border-[#cfe3f9]" />
            <Button fullWidth type="submit">Sign in</Button>
            {authError && <p className="text-sm text-red-600 text-center">{authError}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <Layout isAdmin>
      <div className="w-full max-w-6xl mx-auto p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[#0B1B34] tracking-tight">WebinarGeek</h1>
            {lastFetchAt && (
              <p className="text-[11px] text-slate-500 mt-0.5">
                Loaded {new Date(lastFetchAt).toLocaleString()} · range {lastFetchRange}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void fetchDashboardData()} disabled={loading}>
              {loading ? (
                <>
                  <RefreshCw size={15} className="mr-1 animate-spin" /> Fetching…
                </>
              ) : (
                'Fetch data'
              )}
            </Button>
            <Button type="button" variant="outline" onClick={() => void runSync()} disabled={syncLoading || loading}>
              {syncLoading ? 'Syncing…' : 'Sync'}
            </Button>
            <Button type="button" variant="outline" onClick={handleCsvExport} disabled={!filteredRows.length}>
              <Download size={15} className="mr-1" /> CSV
            </Button>
          </div>
        </div>

        {subscriptionCache !== null && (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-3">{scopeTitle}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
              {statTiles.map((c) => (
                <div key={c.k} className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2">
                  <p className="text-[10px] text-slate-500 font-medium">{c.k}</p>
                  <p className="text-lg font-semibold text-slate-900 tabular-nums">{c.v}</p>
                  <p className="text-[10px] text-slate-400">{c.sub}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {subscriptionCache !== null && nameProfiles.length > 0 && (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <UserCircle2 size={18} className="text-[#005EB8] shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">Filter by name (custom field)</p>
                  <p className="text-[11px] text-slate-500">
                    Names come from <span className="font-mono">cooper_*</span> / <span className="font-mono">rms_*</span> tags
                    (prefix stripped). Click a person to filter the table.
                  </p>
                </div>
              </div>
              {selectedNameKey && (
                <button
                  type="button"
                  onClick={() => setSelectedNameKey(null)}
                  className="text-[11px] font-medium text-[#005EB8] hover:underline shrink-0"
                >
                  Clear name filter
                </button>
              )}
            </div>
            <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory">
              <NameProfileCard
                displayName="All names"
                initials="All"
                scheduled={nameProfiles.reduce((s, p) => s + p.scheduled, 0)}
                full={nameProfiles.reduce((s, p) => s + p.full, 0)}
                half={nameProfiles.reduce((s, p) => s + p.half, 0)}
                notYet={nameProfiles.reduce((s, p) => s + p.notYet, 0)}
                active={selectedNameKey === null}
                onSelect={() => setSelectedNameKey(null)}
              />
              {nameProfiles.map((p) => (
                <NameProfileCard
                  key={p.key}
                  displayName={p.displayName}
                  initials={profileInitials(p.displayName)}
                  scheduled={p.scheduled}
                  full={p.full}
                  half={p.half}
                  notYet={p.notYet}
                  active={selectedNameKey === p.key}
                  onSelect={() => setSelectedNameKey((prev) => (prev === p.key ? null : p.key))}
                />
              ))}
            </div>
          </section>
        )}

        {subscriptionCache === null && !loading && (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-center text-sm text-slate-600">
            Press <strong>Fetch data</strong> to load a snapshot. Month and day views are local only until you fetch again or reload the page.
          </div>
        )}

        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  if (scopeMode === 'week') setWeekAnchorYmd((v) => shiftYmdDays(v, -7));
                  else if (scopeMode === 'day') setSelectedDayYmd((v) => shiftYmdDays(v || torontoYmdFromDate(), -1));
                  else setMonthAnchorYmd((m) => shiftMonthFirstYmd(m, -1));
                }}
                aria-label={`Previous ${scopeMode}`}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={2.5} aria-hidden />
              </button>
              <span className="text-sm font-medium text-slate-800 min-w-[12rem] text-center px-2">
                {scopeMode === 'week'
                  ? weekWindow.title
                  : (scopeMode === 'day' && selectedDayYmd ? ymdToShortLabel(selectedDayYmd) : monthWindow.title)}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (scopeMode === 'week') setWeekAnchorYmd((v) => shiftYmdDays(v, 7));
                  else if (scopeMode === 'day') setSelectedDayYmd((v) => shiftYmdDays(v || torontoYmdFromDate(), 1));
                  else setMonthAnchorYmd((m) => shiftMonthFirstYmd(m, 1));
                }}
                aria-label={`Next ${scopeMode}`}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                <ChevronRight className="h-5 w-5" strokeWidth={2.5} aria-hidden />
              </button>
              <Button
                type="button"
                variant="outline"
                className="!min-h-0 h-9 px-3 py-0 text-xs ml-1"
                onClick={() => {
                  setMonthAnchorYmd(torontoMonthStartToday());
                  setSelectedDayYmd(torontoYmdFromDate());
                  setWeekAnchorYmd(torontoYmdFromDate());
                }}
              >
                Current
              </Button>
              <div className="ml-2 inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5 text-[11px]">
                {(['month', 'week', 'day'] as ScopeMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setScopeMode(m);
                      if (m === 'day' && !selectedDayYmd) setSelectedDayYmd(torontoYmdFromDate());
                    }}
                    className={`px-2.5 py-1 rounded-lg capitalize ${
                      scopeMode === m ? 'bg-white border border-slate-300 text-slate-900' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <label className="relative flex-1 min-w-[12rem] max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Name, email, phone, file tag, or notes"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-200 bg-slate-50/50 focus:outline-none focus:ring-2 focus:ring-slate-300/80"
              />
            </label>
          </div>

          <div className="grid grid-cols-7 gap-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-slate-500 mb-1.5">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {calendarCells.map((day, idx) => {
              if (day == null) {
                return <div key={`e-${idx}`} className="min-h-[64px] rounded-xl bg-slate-50/80" />;
              }
              const ymd = `${viewYear}-${pad2(viewMonth0 + 1)}-${pad2(day)}`;
              const counts = dayCounts.get(ymd);
              const invited = counts?.invited ?? 0;
              const watched = counts?.watched ?? 0;
              const schedules = counts?.schedules ?? 0;
              const active = selectedDayYmd === ymd;
              const label = shortCalendarDayLabel(viewYear, viewMonth0, day);
              return (
                <button
                  key={ymd}
                  type="button"
                  onClick={() => {
                    if (scopeMode === 'week') {
                      setWeekAnchorYmd(ymd);
                    } else {
                      setSelectedDayYmd((prev) => (prev === ymd ? null : ymd));
                      if (scopeMode === 'day') setSelectedDayYmd(ymd);
                    }
                  }}
                  className={`min-h-[64px] rounded-xl border text-left px-2 py-1 flex flex-col justify-center gap-0.5 transition ${
                    active || (scopeMode === 'week' && ymd >= weekWindow.since && ymd <= weekWindow.until)
                      ? 'border-slate-800 bg-slate-100 shadow-inner'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <span className="text-[11px] font-semibold text-slate-900 leading-tight">{label}</span>
                  <span className="text-[10px] text-slate-500 tabular-nums leading-tight">
                    {invited === 0 ? '—' : `${invited} invited`}
                  </span>
                  {schedules > 0 && (
                    <span className="text-[9px] text-indigo-700 tabular-nums font-medium leading-tight">
                      {schedules} scheduled
                    </span>
                  )}
                  {invited > 0 && (
                    <span className="text-[9px] text-slate-600 tabular-nums font-medium leading-tight">{pct(watched, invited)} watched</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-indigo-700 mb-1">Upcoming webinar schedules</p>
            {schedulesInViewMonth.length === 0 ? (
              <p className="text-xs text-indigo-900/70">No future schedules in this month.</p>
            ) : (
              <div className="space-y-1.5">
                {(showAllSchedules ? schedulesInViewMonth : schedulesInViewMonth.slice(0, 8)).map((s) => {
                  const key = `${s.id}-${s.dateMs}`;
                  const expanded = expandedScheduleKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setExpandedScheduleKey((prev) => (prev === key ? null : key))}
                      className="w-full text-left rounded-lg border border-indigo-100 bg-white/70 px-2.5 py-1.5 hover:bg-white transition"
                    >
                      <div className="text-xs text-indigo-950 flex flex-wrap items-center gap-x-2">
                        <span className="font-medium tabular-nums">{formatDateTimeCanadaEastern(s.dateMs)}</span>
                        <span className="text-indigo-700">{s.title}</span>
                      </div>
                      {expanded && (
                        <div className="mt-1.5 text-[11px] text-indigo-800/90 space-y-0.5">
                          <p>
                            <span className="font-medium">Webinar:</span> {s.webinarTitle}
                          </p>
                          <p>
                            <span className="font-medium">Status:</span> {s.status}
                          </p>
                          <p>
                            <span className="font-medium">Registered:</span>{' '}
                            {s.subscriptionsCount == null ? 'n/a' : String(s.subscriptionsCount)}
                          </p>
                        </div>
                      )}
                    </button>
                  );
                })}
                {schedulesInViewMonth.length > 8 && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowAllSchedules((prev) => !prev);
                      setExpandedScheduleKey(null);
                    }}
                    className="text-[11px] text-indigo-700 hover:text-indigo-900 font-medium underline underline-offset-2"
                  >
                    {showAllSchedules
                      ? 'Hide extra schedules'
                      : `+${schedulesInViewMonth.length - 8} more schedules (click to expand)`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">{error}</div>}
        {wgNotesError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950">{wgNotesError}</div>
        )}

        <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
            <p className="text-xs font-medium text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                {scopeMode === 'week'
                  ? weekWindow.title
                  : (scopeMode === 'day' && selectedDayYmd ? ymdToShortLabel(selectedDayYmd) : monthWindow.title)}
              </span>
              {wgNotesLoading && (
                <span className="text-[10px] font-normal text-slate-400">Loading HR notes…</span>
              )}
              {watchToneFilter === 'full' && (
                <span className="text-emerald-800 font-semibold"> · Full watch only</span>
              )}
              {watchToneFilter === 'half' && (
                <span className="text-sky-800 font-semibold"> · Half+ only</span>
              )}
              {watchToneFilter === 'low' && (
                <span className="text-rose-800 font-semibold"> · Little / none only</span>
              )}
              {selectedNameKey && (
                <span className="text-[#005EB8] font-semibold">
                  {' '}
                  ·{' '}
                  {nameProfiles.find((p) => p.key === selectedNameKey)?.displayName ?? selectedNameKey}
                </span>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-600">
              <button
                type="button"
                onClick={() => toggleWatchToneFilter('full')}
                aria-pressed={watchToneFilter === 'full'}
                title="Show only full-watch rows. Click again to clear."
                className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 ${
                  watchToneFilter === 'full'
                    ? 'border-emerald-500 bg-emerald-100/90 text-emerald-950 shadow-sm'
                    : 'border-transparent hover:bg-emerald-50/80 hover:border-emerald-200/80'
                }`}
              >
                <span className="h-2.5 w-6 shrink-0 rounded bg-emerald-100 border border-emerald-200/80" aria-hidden />
                Full watch
              </button>
              <button
                type="button"
                onClick={() => toggleWatchToneFilter('half')}
                aria-pressed={watchToneFilter === 'half'}
                title="Show only half+ watch rows. Click again to clear."
                className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/80 ${
                  watchToneFilter === 'half'
                    ? 'border-sky-500 bg-sky-100/90 text-sky-950 shadow-sm'
                    : 'border-transparent hover:bg-sky-50/80 hover:border-sky-200/80'
                }`}
              >
                <span className="h-2.5 w-6 shrink-0 rounded bg-sky-100 border border-sky-200/80" aria-hidden />
                Half+
              </button>
              <button
                type="button"
                onClick={() => toggleWatchToneFilter('low')}
                aria-pressed={watchToneFilter === 'low'}
                title="Show only little / none watch rows. Click again to clear."
                className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/80 ${
                  watchToneFilter === 'low'
                    ? 'border-rose-500 bg-rose-100/90 text-rose-950 shadow-sm'
                    : 'border-transparent hover:bg-rose-50/80 hover:border-rose-200/80'
                }`}
              >
                <span className="h-2.5 w-6 shrink-0 rounded bg-rose-100 border border-rose-200/80" aria-hidden />
                Little / none
              </button>
            </div>
          </div>
          <div className="overflow-auto max-h-[min(70vh,560px)]">
            <table className="min-w-full text-xs text-slate-800">
              <thead className="bg-white sticky top-0 z-10 border-b border-slate-200">
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 font-medium">File tag name</th>
                  <th className="px-3 py-2 font-medium">Caller</th>
                  <th className="px-3 py-2 font-medium">Scheduled</th>
                  <th className="px-3 py-2 font-medium min-w-[9rem]">Status / notes</th>
                  <th className="px-3 py-2 font-medium">Registered</th>
                  <th className="px-3 py-2 font-medium">Watched</th>
                  <th className="px-3 py-2 font-medium">Watch (min)</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-slate-500">
                      No rows
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const name = candidateDisplayNameFromRow(row) || '0';
                    const wgName = `${String(row.firstname || '').trim()} ${String(row.surname || '').trim()}`.trim();
                    const durationSec = Number(row.watch_duration || 0);
                    const regMs = asUnixMs(row.created_at);
                    const scheduledMs = asUnixMs((row.broadcast as AnyRow | undefined)?.date);
                    const tone = watchRowToneClass(durationSec);
                    const latest = latestWebinarGeekNote(wgNotesBySubId[subscriptionKey(row)]);
                    return (
                      <tr
                        key={String(row.id)}
                        className={`border-b border-slate-100/90 cursor-pointer ${tone}`}
                        onClick={() => setSelectedRow(row)}
                      >
                        <td className="px-3 py-2 font-medium text-slate-900">
                          <span>{name}</span>
                          {wgName && wgName.toLowerCase() !== name.toLowerCase() && (
                            <span className="block text-[10px] font-normal text-slate-500 truncate" title="WebinarGeek registration name">
                              Reg: {wgName}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-700">{String(row.email || '0')}</td>
                        <td className="px-3 py-2 text-slate-700 tabular-nums">{getPhoneDisplay(row)}</td>
                        <td className="px-3 py-2 text-slate-700">{fileTagNameFromRow(row)}</td>
                        <td className="px-3 py-2 text-slate-600">{callerDisplayFromRow(row)}</td>
                        <td className="px-3 py-2 text-slate-600 tabular-nums">
                          {scheduledMs ? formatDateTimeCanadaEastern(scheduledMs) : '0'}
                        </td>
                        <td className="px-3 py-2 text-slate-700 align-top max-w-[14rem]">
                          {latest ? (
                            <>
                              <p className="text-[11px] leading-snug line-clamp-2">{latest.text}</p>
                              <p className="text-[9px] text-slate-500 mt-0.5 tabular-nums">
                                {latest.authorEmail ? `${latest.authorEmail} · ` : ''}
                                {formatDateTimeCanadaEastern(latest.createdAt)}
                              </p>
                            </>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600 tabular-nums">
                          {regMs ? formatDateTimeCanadaEastern(regMs) : '0'}
                        </td>
                        <td className="px-3 py-2">{row.watched === true ? 'Yes' : 'No'}</td>
                        <td className="px-3 py-2 tabular-nums">{watchMinutes(row.watch_duration)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {selectedRow && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-slate-200 w-full max-w-lg max-h-[85vh] overflow-auto shadow-xl flex flex-col">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
                <p className="font-semibold text-slate-900">Details</p>
                <button type="button" onClick={() => setSelectedRow(null)} className="text-slate-400 hover:text-slate-700 p-1" aria-label="Close">
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm shrink-0">
                <Detail label="Name (from file)" value={candidateDisplayNameFromRow(selectedRow) || '0'} />
                <Detail
                  label="Registration name"
                  value={`${String(selectedRow.firstname || '').trim()} ${String(selectedRow.surname || '').trim()}`.trim() || '0'}
                />
                <Detail label="Email" value={String(selectedRow.email || '0')} />
                <Detail label="Phone" value={getPhoneDisplay(selectedRow)} />
                <Detail label="Name (file tag)" value={fileTagNameFromRow(selectedRow)} />
                <Detail label="Caller" value={callerDisplayFromRow(selectedRow)} />
                <Detail
                  label="Filename tag"
                  value={(() => {
                    const a = getInviterAttributionFromRow(selectedRow);
                    return a.raw || '—';
                  })()}
                />
                <Detail
                  label="Scheduled"
                  value={(() => {
                    const t = asUnixMs((selectedRow.broadcast as AnyRow | undefined)?.date);
                    return t ? formatDateTimeCanadaEastern(t) : '0';
                  })()}
                />
                <Detail
                  label="Registered"
                  value={(() => {
                    const t = asUnixMs(selectedRow.created_at);
                    return t ? formatDateTimeCanadaEastern(t) : '0';
                  })()}
                />
                <Detail label="Watched" value={selectedRow.watched === true ? 'Yes' : 'No'} />
                <Detail label="Watch (min)" value={String(watchMinutes(selectedRow.watch_duration))} />
                <Detail label="Subscription" value={selectedRow.unsubscribed === true ? 'Unsubscribed' : 'Active'} />
              </div>
              <div className="border-t border-slate-100 px-4 py-3 flex-1 min-h-0 flex flex-col gap-3">
                <p className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                  <MessageSquare size={14} className="text-slate-400" />
                  HR notes (shared)
                </p>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {(() => {
                    const sid = subscriptionKey(selectedRow);
                    const list = [...(wgNotesBySubId[sid] ?? [])].sort(
                      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                    );
                    if (list.length === 0) {
                      return <p className="text-xs text-slate-400">No notes yet.</p>;
                    }
                    return list.map((n) => (
                      <div key={n.id} className="text-xs bg-slate-50 border border-slate-100 rounded-lg p-2.5">
                        <p className="text-slate-800 whitespace-pre-wrap break-words">{n.text}</p>
                        <p className="text-[10px] text-slate-500 mt-1 tabular-nums">
                          {formatDateTimeCanadaEastern(n.createdAt)}
                          {n.authorEmail ? ` · ${n.authorEmail}` : ''}
                        </p>
                      </div>
                    ));
                  })()}
                </div>
                <div className="flex flex-col gap-2">
                  <textarea
                    value={newWgNote}
                    onChange={(e) => setNewWgNote(e.target.value)}
                    placeholder="Add a note for this subscriber…"
                    rows={3}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300/80 resize-y min-h-[4.5rem]"
                  />
                  <Button type="button" onClick={() => void handleAddWgHrNote()} disabled={!newWgNote.trim() || savingWgNote}>
                    {savingWgNote ? 'Saving…' : 'Save note'}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-xs text-[#60728c]">{label}</p>
    <p className="text-sm text-[#0B1B34]">{value?.trim() ? value : '0'}</p>
  </div>
);

type NameProfileCardProps = {
  displayName: string;
  initials: string;
  scheduled: number;
  full: number;
  half: number;
  notYet: number;
  active: boolean;
  onSelect: () => void;
};

const NameProfileCard: React.FC<NameProfileCardProps> = ({
  displayName,
  initials,
  scheduled,
  full,
  half,
  notYet,
  active,
  onSelect,
}) => (
  <button
    type="button"
    onClick={onSelect}
    className={`snap-start shrink-0 w-[min(100%,11.5rem)] rounded-2xl border px-3 py-2.5 text-left transition ${
      active
        ? 'border-[#005EB8] bg-[#005EB8]/5 shadow-md ring-1 ring-[#005EB8]/30'
        : 'border-slate-200 bg-slate-50/80 hover:border-slate-300 hover:bg-white'
    }`}
  >
    <div className="flex items-center gap-2.5 mb-2">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
          active ? 'bg-[#005EB8] text-white' : 'bg-slate-200 text-slate-700'
        }`}
      >
        {initials}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-900 truncate">{displayName}</p>
        <p className="text-[10px] text-slate-500 tabular-nums">{scheduled} scheduled</p>
      </div>
    </div>
    <div className="grid grid-cols-3 gap-1 text-center">
      <div className="rounded-lg bg-emerald-50 border border-emerald-100/80 px-1 py-1">
        <p className="text-[9px] uppercase tracking-wide text-emerald-800 font-medium">Full</p>
        <p className="text-sm font-bold text-emerald-900 tabular-nums">{full}</p>
      </div>
      <div className="rounded-lg bg-sky-50 border border-sky-100/80 px-1 py-1">
        <p className="text-[9px] uppercase tracking-wide text-sky-800 font-medium">Half+</p>
        <p className="text-sm font-bold text-sky-900 tabular-nums">{half}</p>
      </div>
      <div className="rounded-lg bg-rose-50 border border-rose-100/80 px-1 py-1">
        <p className="text-[9px] uppercase tracking-wide text-rose-800 font-medium">Not yet</p>
        <p className="text-sm font-bold text-rose-900 tabular-nums">{notYet}</p>
      </div>
    </div>
  </button>
);

export default WebinarGeekDashboard;
