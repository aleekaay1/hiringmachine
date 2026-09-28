import React from 'react';
import { ClipboardList, Link2, RefreshCw, Search } from 'lucide-react';
import { Button } from '../components/UI';
import {
  formatSignupSessionAt,
  formatSignupSubmittedAt,
  listPublicWebinarSignups,
  matchFormSignupsToCampaignLeads,
  type PublicWebinarLeadSource,
  type PublicWebinarSignupRow,
} from '../services/publicWebinarSignupsAdmin';

type SourceFilter = 'all' | 'unreviewed' | PublicWebinarLeadSource;

function sourceBadge(row: PublicWebinarSignupRow) {
  if (row.lead_source === 'cold_email') {
    return (
      <span className="inline-flex rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-800">
        Cold email
      </span>
    );
  }
  if (row.lead_source === 'elsewhere') {
    return (
      <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
        Elsewhere
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
      Not matched yet
    </span>
  );
}

const ScheduleWebinarSignupsPage: React.FC = () => {
  const [rows, setRows] = React.useState<PublicWebinarSignupRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [matching, setMatching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [sourceFilter, setSourceFilter] = React.useState<SourceFilter>('all');

  const load = React.useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const next = await listPublicWebinarSignups();
      setRows(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load webinar form signups');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const stats = React.useMemo(() => {
    let cold = 0;
    let elsewhere = 0;
    let unreviewed = 0;
    for (const row of rows) {
      if (row.lead_source === 'cold_email') cold += 1;
      else if (row.lead_source === 'elsewhere') elsewhere += 1;
      else unreviewed += 1;
    }
    return { cold, elsewhere, unreviewed, total: rows.length };
  }, [rows]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (sourceFilter === 'unreviewed' && row.lead_source) return false;
      if (sourceFilter === 'cold_email' && row.lead_source !== 'cold_email') return false;
      if (sourceFilter === 'elsewhere' && row.lead_source !== 'elsewhere') return false;
      if (!q) return true;
      const hay = [
        row.first_name,
        row.last_name,
        row.email,
        row.phone,
        row.schedule_mode,
        row.broadcast_id,
        row.reference,
        row.lead_source,
        row.matched_campaign_name,
      ]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
  }, [rows, query, sourceFilter]);

  const onMatch = async () => {
    setError(null);
    setMsg(null);
    setMatching(true);
    try {
      const result = await matchFormSignupsToCampaignLeads();
      setMsg(
        `Matched ${result.total} signups against ${result.campaign_leads} campaign emails: ${result.cold_email} from cold email, ${result.elsewhere} from elsewhere.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not match campaign leads');
    } finally {
      setMatching(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[#005EB8]">
            <ClipboardList className="h-5 w-5" />
            <p className="text-xs font-semibold uppercase tracking-wide">Public form</p>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Schedule webinar signups</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            People who submitted `/schedule-webinar`. Match them to bulk-email campaign leads to see
            who came from cold email vs somewhere else (reference / other).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="!min-h-0 h-10 px-3"
            onClick={() => void load()}
            disabled={loading || matching}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button
            type="button"
            className="!min-h-0 h-10 px-3"
            onClick={() => void onMatch()}
            disabled={loading || matching}
          >
            <Link2 className={`mr-2 h-4 w-4 ${matching ? 'animate-pulse' : ''}`} />
            {matching ? 'Matching…' : 'Match campaign leads'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['all', `All (${stats.total})`],
            ['cold_email', `Cold email (${stats.cold})`],
            ['elsewhere', `Elsewhere (${stats.elsewhere})`],
            ['unreviewed', `Not matched (${stats.unreviewed})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSourceFilter(id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              sourceFilter === id
                ? 'border-[#005EB8] bg-[#eef6ff] text-[#005EB8]'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, phone, campaign…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none ring-[#005EB8]/30 focus:ring-2"
          />
        </div>
        <p className="text-xs text-slate-500">
          {filtered.length} shown{query.trim() || sourceFilter !== 'all' ? ` · ${rows.length} total` : ''}
        </p>
      </div>

      {msg && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {msg}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Submitted</th>
              <th className="px-3 py-2.5 font-semibold">Name</th>
              <th className="px-3 py-2.5 font-semibold">Email / Phone</th>
              <th className="px-3 py-2.5 font-semibold">Mode</th>
              <th className="px-3 py-2.5 font-semibold">Scheduled session</th>
              <th className="px-3 py-2.5 font-semibold">Source</th>
              <th className="px-3 py-2.5 font-semibold">Reference</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                  Loading signups…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                  No schedule-form submissions yet.
                </td>
              </tr>
            )}
            {!loading &&
              filtered.map((row) => (
                <tr key={row.id} className="align-top hover:bg-slate-50/80">
                  <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                    {formatSignupSubmittedAt(row.created_at)}
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-medium text-slate-900">
                      {[row.first_name, row.last_name].filter(Boolean).join(' ') || '—'}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    <p className="text-slate-900">{row.email}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{row.phone || '—'}</p>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        row.schedule_mode === 'quick'
                          ? 'bg-emerald-50 text-emerald-800'
                          : 'bg-blue-50 text-blue-800'
                      }`}
                    >
                      {row.schedule_mode === 'quick' ? 'Watch now' : 'Pick a time'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    {formatSignupSessionAt(row.session_at)}
                  </td>
                  <td className="px-3 py-3">
                    {sourceBadge(row)}
                    {row.lead_source === 'cold_email' && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        {row.matched_campaign_name || 'Campaign lead'}
                        {row.matched_recipient_status ? ` · ${row.matched_recipient_status}` : ''}
                      </p>
                    )}
                    {row.lead_source === 'elsewhere' && (
                      <p className="mt-1 text-[11px] text-slate-500">Not from email marketing</p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    {row.reference?.trim() || '—'}
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-600">
                    <p>{row.already_registered ? 'Already registered' : 'New booking'}</p>
                    <p className="mt-0.5">
                      Email verified:{' '}
                      {row.email_verified === true ? 'Yes' : row.email_verified === false ? 'No' : '—'}
                    </p>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ScheduleWebinarSignupsPage;
