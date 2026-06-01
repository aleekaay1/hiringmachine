import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileSpreadsheet, FileText, RefreshCw, Search, UserCircle } from 'lucide-react';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { useAdminSessionOnce } from '../components/reports/useAdminSessionOnce';
import { ReportDateRangeBar } from '../components/reports/ReportDateRangeBar';
import { profileInitials } from '../services/webinarGeekRecruiterAnalytics';
import {
  buildReportDateRange,
  listReportableStaff,
  loadTeamReportCards,
  refreshReportSourcesFromRemote,
  type ReportDatePreset,
  type StaffReportCard,
} from '../services/reportsService';
import {
  loadReportsMeta,
  loadTeamReportSnapshot,
  saveReportsMeta,
  saveTeamReportSnapshot,
  teamReportSnapshotKey,
} from '../services/reportsSnapshotCache';
import { exportTeamSummariesCsv } from '../services/reportsExport';
import { torontoYmdFromDate } from '../services/webinarGeekDates';

const ROLE_LABEL: Record<string, string> = {
  recruiter: 'Recruiter',
  leadership: 'Leadership',
  webinar: 'Webinar',
  hr: 'HR',
  viewer: 'Viewer',
};

function formatRefreshedAt(iso: string | null): string {
  if (!iso) return 'Not saved yet';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const Reports: React.FC = () => {
  useAdminSessionOnce();
  const navigate = useNavigate();
  const [preset, setPreset] = React.useState<ReportDatePreset>('friday_week');
  const [customSince, setCustomSince] = React.useState(() => torontoYmdFromDate());
  const [customUntil, setCustomUntil] = React.useState(() => torontoYmdFromDate());
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [cards, setCards] = React.useState<StaffReportCard[]>([]);
  const [lastUpdated, setLastUpdated] = React.useState<string | null>(null);
  const [webinarFetchedAt, setWebinarFetchedAt] = React.useState<string | null>(null);

  const range = React.useMemo(
    () =>
      buildReportDateRange(
        preset,
        preset === 'custom' ? { sinceYmd: customSince, untilYmd: customUntil } : undefined,
      ),
    [preset, customSince, customUntil],
  );

  const applyCards = React.useCallback((next: StaffReportCard[], fetchedAt: string | null) => {
    const sorted = [...next].sort((a, b) => b.summary.webinarShowed - a.summary.webinarShowed);
    setCards(sorted);
    setLastUpdated(fetchedAt);
  }, []);

  const loadFromDbOrCompute = React.useCallback(
    async (opts?: { forceCompute?: boolean }) => {
      setError(null);
      if (!opts?.forceCompute) {
        const cached = await loadTeamReportSnapshot(range);
        if (!cached.tableMissing && cached.data?.cards.length) {
          applyCards(cached.data.cards, cached.data.fetchedAt);
          return;
        }
      }
      const staff = await listReportableStaff();
      const summaries = await loadTeamReportCards(staff, range);
      const saved = await saveTeamReportSnapshot(range, summaries);
      if (saved.error && !saved.tableMissing) {
        setError(saved.error);
      }
      await saveReportsMeta({
        lastTeamSnapshotAt: saved.fetchedAt,
        lastTeamRangeKey: teamReportSnapshotKey(range),
      });
      applyCards(summaries, saved.fetchedAt);
    },
    [range, applyCards],
  );

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const meta = await loadReportsMeta();
        if (!cancelled) setWebinarFetchedAt(meta.data?.lastWebinarFetchAt ?? null);
        await loadFromDbOrCompute();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setCards([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [loadFromDbOrCompute]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((card) => {
      const name = String(card.profile.full_name || '').toLowerCase();
      const email = String(card.profile.email || '').toLowerCase();
      const role = String(card.profile.role || '').toLowerCase();
      return name.includes(q) || email.includes(q) || role.includes(q);
    });
  }, [cards, query]);

  const handleRefreshSources = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const result = await refreshReportSourcesFromRemote();
      if (!result.ok) throw new Error(result.error || 'Refresh failed');
      await saveReportsMeta({
        lastWebinarFetchAt: result.fetchedAt ?? new Date().toISOString(),
        webinarRowCount: result.webinarCount,
      });
      const meta = await loadReportsMeta();
      setWebinarFetchedAt(meta.data?.lastWebinarFetchAt ?? null);
      await loadFromDbOrCompute({ forceCompute: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Layout isAdmin>
      <div className="mx-auto w-full min-w-0 max-w-6xl p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.26em] text-[#4e79a9]">Administration</p>
            <h1
              className="text-2xl font-semibold text-[#0B1B34]"
              style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}
            >
              Reports
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-[#5c7594]">
              WebinarGeek API data (bookings & shows). Snapshots are saved in the database per date range.
            </p>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <div className="flex flex-wrap gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => exportTeamSummariesCsv(cards, range.label)}
                disabled={!cards.length}
              >
                <FileSpreadsheet size={15} className="mr-1" />
                Export team CSV
              </Button>
              <Button onClick={() => void handleRefreshSources()} disabled={refreshing}>
                <RefreshCw size={15} className={refreshing ? 'mr-1 animate-spin' : 'mr-1'} />
                {refreshing ? 'Fetching…' : 'Generate report'}
              </Button>
            </div>
            <p className="text-[9px] text-[#8aa3be] tabular-nums">
              Saved {formatRefreshedAt(lastUpdated)}
              {webinarFetchedAt ? ` · WG ${formatRefreshedAt(webinarFetchedAt)}` : ''}
            </p>
          </div>
        </div>

        <ReportDateRangeBar
          preset={preset}
          onPresetChange={setPreset}
          customSince={customSince}
          customUntil={customUntil}
          onCustomSince={setCustomSince}
          onCustomUntil={setCustomUntil}
          rangeLabel={range.label}
        />

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
        )}

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6d86a3]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, or role…"
            className="w-full rounded-2xl border border-[#d9e5f6] bg-white py-2.5 pl-10 pr-3 text-sm text-[#0B1B34] placeholder:text-[#8aa3be] focus:outline-none focus:ring-2 focus:ring-[#8bc3ff]/40"
          />
        </div>

        {loading ? (
          <div className="rounded-2xl border border-[#dfeaf8] bg-white px-4 py-10 text-center text-sm text-[#5c7594]">
            Loading saved reports…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-[#dfeaf8] bg-white px-4 py-10 text-center text-sm text-[#5c7594]">
            {cards.length === 0
              ? 'No saved report for this range. Click Generate report to fetch WebinarGeek and save.'
              : 'No team members match your search.'}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((card) => {
              const name = card.profile.full_name || card.profile.email?.split('@')[0] || 'Team member';
              return (
                <button
                  key={card.profile.user_id}
                  type="button"
                  onClick={() =>
                    navigate(
                      `/reports/${card.profile.user_id}?preset=${encodeURIComponent(preset)}${
                        preset === 'custom'
                          ? `&since=${encodeURIComponent(customSince)}&until=${encodeURIComponent(customUntil)}`
                          : ''
                      }`,
                    )
                  }
                  className="rounded-2xl border border-[#d9e5f6] bg-white/90 p-4 text-left shadow-sm transition hover:border-[#8bc3ff] hover:shadow-md"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#dff0ff] text-sm font-bold text-[#0B1B34]">
                      {profileInitials(name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-[#0B1B34]">{name}</p>
                      <p className="truncate text-[11px] text-[#5c7594]">{card.profile.email}</p>
                      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#2f6ea8]">
                        {ROLE_LABEL[card.profile.role] || card.profile.role}
                      </p>
                    </div>
                    <UserCircle size={18} className="shrink-0 text-[#8aa3be]" aria-hidden />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-lg bg-[#f7fbff] px-2 py-1.5">
                      <p className="text-[#6d86a3]">Webinar booked</p>
                      <p className="font-bold tabular-nums text-[#0B1B34]">{card.summary.webinarBooked}</p>
                    </div>
                    <div className="rounded-lg bg-[#f7fbff] px-2 py-1.5">
                      <p className="text-[#6d86a3]">Webinar shows</p>
                      <p className="font-bold tabular-nums text-[#0B1B34]">{card.summary.webinarShowed}</p>
                    </div>
                    <div className="rounded-lg bg-[#f7fbff] px-2 py-1.5 col-span-2">
                      <p className="text-[#6d86a3]">Paz coins</p>
                      <p className="font-bold tabular-nums text-[#0B1B34]">{card.summary.pazCoins}</p>
                    </div>
                  </div>
                  <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#2f6ea8]">
                    <FileText size={13} aria-hidden />
                    Open full report
                  </p>
                </button>
              );
            })}
          </div>
        )}

        <p className="text-center text-xs text-[#6d86a3]">
          <Link to="/home" className="font-semibold text-[#2f6ea8] hover:underline">
            Back to dashboard
          </Link>
        </p>
      </div>
    </Layout>
  );
};

export default Reports;
