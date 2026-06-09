import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, RefreshCw, Search } from 'lucide-react';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import {
  canAccessHrLeadDistribution,
  getCurrentUserProfile,
} from '../services/accessControl';
import { formatDateCanadaEastern, formatDateTimeCanadaEastern } from '../services/dateDisplay';
import {
  fetchHrAllLeads,
  fetchHrLeadBatches,
  type HrAllLeadRow,
  type PipelineLeadBatch,
} from '../services/pipelineHrLeadsService';

type GroupedLeads = {
  team: string;
  batches: Array<{
    batchKey: string;
    batchLabel: string;
    sourceFilename: string;
    uploadDate: string;
    items: HrAllLeadRow[];
  }>;
};

function buildGroups(leads: HrAllLeadRow[]): GroupedLeads[] {
  const byTeam = new Map<string, Map<string, HrAllLeadRow[]>>();
  for (const lead of leads) {
    const team = lead.lead_team?.trim() || 'Other';
    const batchKey = lead.lead_batch_id || lead.batch_label || 'unbatched';
    if (!byTeam.has(team)) byTeam.set(team, new Map());
    const batchMap = byTeam.get(team)!;
    if (!batchMap.has(batchKey)) batchMap.set(batchKey, []);
    batchMap.get(batchKey)!.push(lead);
  }

  return [...byTeam.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([team, batchMap]) => ({
      team,
      batches: [...batchMap.entries()]
        .map(([batchKey, items]) => {
          const first = items[0];
          return {
            batchKey,
            batchLabel: first.batch_label || 'Import batch',
            sourceFilename: first.source_filename || '',
            uploadDate: first.batch_created_at || first.created_at,
            items: items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
          };
        })
        .sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()),
    }));
}

function dispositionClass(disposition: string | null): string {
  const d = String(disposition || '').toLowerCase();
  if (!d) return 'bg-slate-100 text-slate-600';
  if (d === 'booked') return 'bg-violet-100 text-violet-800';
  if (d === 'no answer') return 'bg-amber-100 text-amber-800';
  return 'bg-[#edf5ff] text-[#285082]';
}

const HrAllLeadsPage: React.FC = () => {
  const [allowed, setAllowed] = React.useState<boolean | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [leads, setLeads] = React.useState<HrAllLeadRow[]>([]);
  const [teams, setTeams] = React.useState<string[]>([]);
  const [batches, setBatches] = React.useState<PipelineLeadBatch[]>([]);
  const [search, setSearch] = React.useState('');
  const [teamFilter, setTeamFilter] = React.useState('');
  const [batchFilter, setBatchFilter] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'pool' | 'assigned'>('all');
  const [dateFrom, setDateFrom] = React.useState('');
  const [dateTo, setDateTo] = React.useState('');
  const [expandedTeams, setExpandedTeams] = React.useState<Set<string>>(() => new Set());
  const [expandedBatches, setExpandedBatches] = React.useState<Set<string>>(() => new Set());

  React.useEffect(() => {
    void getCurrentUserProfile().then((profile) => {
      setAllowed(canAccessHrLeadDistribution(profile?.role ?? null, profile?.email));
    });
  }, []);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [leadsRes, batchRes] = await Promise.all([
        fetchHrAllLeads({
          batchId: batchFilter || undefined,
          team: teamFilter || undefined,
          status: statusFilter,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          search: search.trim() || undefined,
        }),
        fetchHrLeadBatches(50),
      ]);
      if (!leadsRes.ok) throw new Error(leadsRes.error);
      if (!batchRes.ok) throw new Error(batchRes.error);
      setLeads(leadsRes.leads);
      setTeams(leadsRes.teams);
      setBatches(batchRes.batches);
      const groups = buildGroups(leadsRes.leads);
      setExpandedTeams(new Set(groups.map((g) => g.team)));
      setExpandedBatches(new Set(groups.flatMap((g) => g.batches.map((b) => `${g.team}:${b.batchKey}`))));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [batchFilter, teamFilter, statusFilter, dateFrom, dateTo, search]);

  React.useEffect(() => {
    if (!allowed) return;
    void loadData();
  }, [allowed, loadData]);

  const groups = React.useMemo(() => buildGroups(leads), [leads]);

  if (allowed === false) {
    return (
      <Layout isAdmin>
        <div className="mx-auto max-w-2xl p-8">
          <h1 className="text-xl font-semibold text-slate-900">All leads</h1>
          <p className="mt-2 text-sm text-slate-600">You do not have access.</p>
          <Link to="/home" className="mt-4 inline-block text-sm font-semibold text-[#005EB8] hover:underline">Back to home</Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout isAdmin>
      <div className="mx-auto max-w-[1400px] space-y-5 p-4 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-[#4b6d95]">
              <Link to="/hr/lead-distribution" className="hover:underline">Lead distribution</Link>
              <span className="mx-1">/</span>
              All leads
            </p>
            <h1 className="text-2xl font-bold text-[#0B1B34]">All leads</h1>
          </div>
          <Button variant="outline" className="!min-h-0 h-9 gap-1.5 text-xs" onClick={() => void loadData()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>

        <section className="rounded-2xl border border-[#cde0f4] bg-white p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <label className="text-xs font-medium text-[#365274] xl:col-span-2">
              Search
              <div className="relative mt-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b84a8]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, email, phone"
                  className="w-full rounded-xl border border-[#c8ddf4] py-2 pl-9 pr-3 text-sm"
                />
              </div>
            </label>
            <label className="text-xs font-medium text-[#365274]">
              Team
              <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="mt-1 w-full rounded-xl border border-[#c8ddf4] px-3 py-2 text-sm">
                <option value="">All teams</option>
                {teams.map((team) => (
                  <option key={team} value={team}>{team}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-[#365274]">
              Batch
              <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)} className="mt-1 w-full rounded-xl border border-[#c8ddf4] px-3 py-2 text-sm">
                <option value="">All batches</option>
                {batches.map((batch) => (
                  <option key={batch.id} value={batch.id}>{batch.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-[#365274]">
              Status
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="mt-1 w-full rounded-xl border border-[#c8ddf4] px-3 py-2 text-sm">
                <option value="all">All</option>
                <option value="pool">Unassigned</option>
                <option value="assigned">Assigned</option>
              </select>
            </label>
            <label className="text-xs font-medium text-[#365274]">
              From
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1 w-full rounded-xl border border-[#c8ddf4] px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium text-[#365274]">
              To
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-1 w-full rounded-xl border border-[#c8ddf4] px-3 py-2 text-sm" />
            </label>
          </div>
          <p className="mt-3 text-xs text-[#4b6d95]">{leads.length} lead(s)</p>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="space-y-3">
          {groups.map((group) => {
            const teamExpanded = expandedTeams.has(group.team);
            return (
              <section key={group.team} className="overflow-hidden rounded-2xl border border-[#cde0f4] bg-white">
                <button
                  type="button"
                  onClick={() => {
                    setExpandedTeams((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.team)) next.delete(group.team);
                      else next.add(group.team);
                      return next;
                    });
                  }}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[#f8fbff]"
                >
                  <div>
                    <p className="text-sm font-semibold text-[#0B1B34]">{group.team}</p>
                    <p className="text-xs text-[#4b6d95]">
                      {group.batches.length} batch(es) · {group.batches.reduce((sum, b) => sum + b.items.length, 0)} leads
                    </p>
                  </div>
                  <ChevronDown size={18} className={`text-[#4b6d95] transition ${teamExpanded ? 'rotate-180' : ''}`} />
                </button>

                {teamExpanded && (
                  <div className="border-t border-[#e3edf8]">
                    {group.batches.map((batch) => {
                      const batchId = `${group.team}:${batch.batchKey}`;
                      const batchExpanded = expandedBatches.has(batchId);
                      return (
                        <div key={batchId} className="border-b border-[#edf3fa] last:border-b-0">
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedBatches((prev) => {
                                const next = new Set(prev);
                                if (next.has(batchId)) next.delete(batchId);
                                else next.add(batchId);
                                return next;
                              });
                            }}
                            className="flex w-full items-center justify-between gap-3 bg-[#fafcff] px-4 py-2.5 text-left hover:bg-[#f4f8ff]"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold text-[#0B1B34]">{batch.batchLabel}</p>
                              <p className="truncate text-[11px] text-[#6b84a8]">
                                {batch.sourceFilename || '—'} · {formatDateCanadaEastern(batch.uploadDate)} · {batch.items.length} leads
                              </p>
                            </div>
                            <ChevronDown size={16} className={`shrink-0 text-[#4b6d95] transition ${batchExpanded ? 'rotate-180' : ''}`} />
                          </button>

                          {batchExpanded && (
                            <div className="overflow-x-auto">
                              <table className="min-w-full text-xs">
                                <thead className="bg-[#f4f8ff] text-left text-[#4b6d95]">
                                  <tr>
                                    <th className="px-3 py-2">Name</th>
                                    <th className="px-3 py-2">Email</th>
                                    <th className="px-3 py-2">Phone</th>
                                    <th className="px-3 py-2">Uploaded</th>
                                    <th className="px-3 py-2">Assigned to</th>
                                    <th className="px-3 py-2">Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {batch.items.map((lead) => (
                                    <tr key={lead.id} className="border-t border-[#edf3fa] hover:bg-[#fafcff]">
                                      <td className="px-3 py-2 font-medium text-[#0B1B34]">{lead.full_name}</td>
                                      <td className="px-3 py-2 text-[#4b6d95]">{lead.email || '—'}</td>
                                      <td className="px-3 py-2 text-[#4b6d95]">{lead.phone || '—'}</td>
                                      <td className="px-3 py-2 whitespace-nowrap text-[#6b84a8]">{formatDateTimeCanadaEastern(lead.batch_created_at || lead.created_at)}</td>
                                      <td className="px-3 py-2 text-[#4b6d95]">{lead.assigned_to_label || '—'}</td>
                                      <td className="px-3 py-2">
                                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${dispositionClass(lead.latest_disposition)}`}>
                                          {lead.assigned_to_user_id
                                            ? (lead.latest_disposition || 'Assigned')
                                            : 'Pool'}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
          {!loading && !groups.length && (
            <p className="rounded-2xl border border-dashed border-[#cde0f4] bg-white px-4 py-12 text-center text-sm text-[#6b84a8]">No leads match filters.</p>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default HrAllLeadsPage;
