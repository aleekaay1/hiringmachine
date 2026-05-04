import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { supabase } from '../services/supabaseClient';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { Download, Mail, RefreshCw, Search } from 'lucide-react';

type EmailSendLogRow = {
  id: string;
  created_at: string;
  source: string;
  trigger_label: string | null;
  from_email: string;
  to_email: string;
  cc_email: string | null;
  subject: string;
  candidate_id: string | null;
  sent_by_user_id: string | null;
  status: string;
  error_message: string | null;
};

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const EmailLog: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState('admin@globelife-paz.com');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [rows, setRows] = useState<EmailSendLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: s }) => {
      if (s.session) setIsAuthenticated(true);
    });
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    const { data, error } = await supabase
      .from('email_send_logs')
      .select(
        'id, created_at, source, trigger_label, from_email, to_email, cc_email, subject, candidate_id, sent_by_user_id, status, error_message'
      )
      .order('created_at', { ascending: false })
      .limit(2500);
    setLoading(false);
    if (error) {
      setRows([]);
      const msg = error.message || 'Failed to load.';
      const missing =
        /relation|does not exist|schema cache/i.test(msg) && /email_send_logs/i.test(msg);
      setLoadError(
        missing
          ? 'The email_send_logs table is not deployed yet. Run the latest Supabase migration, then refresh.'
          : msg
      );
      return;
    }
    setRows((data as EmailSendLogRow[]) ?? []);
  }, []);

  useEffect(() => {
    if (isAuthenticated) void load();
  }, [isAuthenticated, load]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthError('Invalid email or password.');
      return;
    }
    setIsAuthenticated(true);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.from_email,
        r.to_email,
        r.cc_email ?? '',
        r.subject,
        r.source,
        r.trigger_label ?? '',
        r.candidate_id ?? '',
        r.sent_by_user_id ?? '',
        r.status,
        r.error_message ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

  const downloadCsv = () => {
    const header = [
      'When (UTC raw)',
      'When (display)',
      'From',
      'To',
      'CC',
      'Subject',
      'Source',
      'Trigger',
      'Candidate ID',
      'Sent by user ID',
      'Status',
      'Error',
    ];
    const lines = [
      header.map(csvEscape).join(','),
      ...filtered.map((r) =>
        [
          r.created_at,
          formatDateTimeCanadaEastern(r.created_at),
          r.from_email,
          r.to_email,
          r.cc_email ?? '',
          r.subject,
          r.source,
          r.trigger_label ?? '',
          r.candidate_id ?? '',
          r.sent_by_user_id ?? '',
          r.status,
          r.error_message ?? '',
        ]
          .map((c) => csvEscape(String(c)))
          .join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `email-send-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#f7fbff] to-[#eef6ff] flex items-center justify-center p-4">
        <div className="bg-white border border-[#d9e9fb] p-8 rounded-[28px] shadow-[0_18px_50px_-24px_rgba(0,94,184,0.35)] w-full max-w-sm">
          <h2 className="text-xl font-bold text-[#0B1B34] mb-1 text-center">Email log</h2>
          <p className="text-sm text-[#6f7b8d] text-center mb-6">Sign in with a staff account (admin, recruiter, or HR)</p>
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-2xl border border-[#cfe3f9] text-[#0B1B34]"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-2xl border border-[#cfe3f9] text-[#0B1B34]"
            />
            <Button fullWidth type="submit">
              Sign in
            </Button>
            {authError && <p className="text-sm text-red-600 text-center">{authError}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <Layout isAdmin>
      <div className="w-full p-5 lg:p-6 space-y-5 text-[#1A2942]">
        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-xl bg-[#005EB8]/10 flex items-center justify-center shrink-0">
              <Mail size={20} className="text-[#005EB8]" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-[#0B1B34] truncate">Email send log</h1>
              <p className="text-sm text-[#5c6b82]">
                Outbound mail from CRM and automations — search by address, subject, trigger, or candidate.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={16} className={loading ? 'animate-spin inline mr-1.5' : 'inline mr-1.5'} />
              Refresh
            </Button>
            <Button type="button" variant="secondary" onClick={downloadCsv} disabled={filtered.length === 0}>
              <Download size={16} className="inline mr-1.5" />
              Export CSV
            </Button>
          </div>
        </div>

        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8a9ab0]" size={18} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search to, from, subject, trigger, source, candidate ID…"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[#cfe3f9] text-sm text-[#0B1B34] focus:outline-none focus:ring-2 focus:ring-[#005EB8]/30"
            />
          </div>
          <div className="text-sm text-[#5c6b82] shrink-0">
            Showing <strong>{filtered.length}</strong> of {rows.length} loaded
          </div>
        </div>

        {loadError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm px-4 py-3">{loadError}</div>
        )}

        <div className="rounded-2xl border border-[#d6deea] bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto max-h-[calc(100vh-280px)] overflow-y-auto">
            <table className="min-w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-[#eef2f7] text-[#0B1B34] font-semibold border-b border-[#d6deea]">
                <tr>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">When</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">From</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">To</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">CC</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] min-w-[140px]">Subject</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">Source</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">Trigger</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">Candidate</th>
                  <th className="px-2 py-2 border-r border-[#d6deea] whitespace-nowrap">Sent by</th>
                  <th className="px-2 py-2 whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="font-mono text-[11px] text-[#1A2942]">
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-[#e8edf4] hover:bg-[#f8fafc] align-top">
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] whitespace-nowrap text-[#334155]">
                      {formatDateTimeCanadaEastern(r.created_at)}
                    </td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] max-w-[200px] break-all">{r.from_email}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] max-w-[220px] break-all">{r.to_email}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] max-w-[160px] break-all">{r.cc_email || '—'}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] max-w-[280px] break-words">{r.subject}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] whitespace-nowrap">{r.source}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] max-w-[200px] break-words">
                      {r.trigger_label || '—'}
                    </td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] break-all max-w-[120px]">{r.candidate_id || '—'}</td>
                    <td className="px-2 py-1.5 border-r border-[#eef2f7] break-all max-w-[120px]">{r.sent_by_user_id || '—'}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className={
                          r.status === 'failed' ? 'text-red-700 font-semibold' : 'text-emerald-800'
                        }
                      >
                        {r.status}
                      </span>
                      {r.error_message ? (
                        <div className="text-red-600 font-sans normal-case mt-0.5 max-w-[240px]">{r.error_message}</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && filtered.length === 0 && !loadError && (
              <div className="p-8 text-center text-sm text-[#6f7b8d]">No rows match your search, or the log is empty.</div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default EmailLog;
