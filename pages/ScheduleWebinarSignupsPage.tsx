import React from 'react';
import { ClipboardList, RefreshCw, Search } from 'lucide-react';
import { Button } from '../components/UI';
import {
  formatSignupSessionAt,
  formatSignupSubmittedAt,
  listPublicWebinarSignups,
  type PublicWebinarSignupRow,
} from '../services/publicWebinarSignupsAdmin';

const ScheduleWebinarSignupsPage: React.FC = () => {
  const [rows, setRows] = React.useState<PublicWebinarSignupRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');

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

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const hay = [
        row.first_name,
        row.last_name,
        row.email,
        row.phone,
        row.schedule_mode,
        row.broadcast_id,
      ]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
      return hay.includes(q);
    });
  }, [rows, query]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[#005EB8]">
            <ClipboardList className="h-5 w-5" />
            <p className="text-xs font-semibold uppercase tracking-wide">Public form</p>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Schedule webinar signups</h1>
          <p className="mt-1 text-sm text-slate-600">
            People who submitted the cold-email schedule form (`/schedule-webinar`), including the
            session they picked.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="!min-h-0 h-10 px-3"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, phone…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none ring-[#005EB8]/30 focus:ring-2"
          />
        </div>
        <p className="text-xs text-slate-500">
          {filtered.length} shown{query.trim() ? ` · ${rows.length} total` : ''}
        </p>
      </div>

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
              <th className="px-3 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                  Loading signups…
                </td>
              </tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
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
                      {row.schedule_mode === 'quick' ? 'Watch soon' : 'Pick a time'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-slate-700">
                    {formatSignupSessionAt(row.session_at)}
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
