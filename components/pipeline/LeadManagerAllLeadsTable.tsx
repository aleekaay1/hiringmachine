import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Phone, Search } from 'lucide-react';
import { formatDateCanadaEastern } from '../../services/dateDisplay';
import { getCandidateBatchGroupKey, type LeadBatchGroup } from '../../services/pipelineLeadGrouping';
import {
  readPipelineCandidateEmail,
  readPipelineCandidatePhone,
  type PipelineCandidate,
  type PipelineCallRecord,
} from '../../services/pipelineService';
import { saveDialQueueIntent } from '../../services/recruiterLeadPackAnalytics';

type SortKey = 'name' | 'email' | 'phone' | 'pack' | 'disposition' | 'calls' | 'assigned';

type Tone = {
  panelTitle: string;
  panelMuted: string;
  panelLabel: string;
  input: string;
  glassPanel: string;
};

function dispositionClass(disposition: string): string {
  const d = disposition.toLowerCase();
  if (!d || d === 'not contacted') return 'bg-slate-100 text-slate-600';
  if (d === 'booked') return 'bg-violet-100 text-violet-800';
  if (d === 'no answer') return 'bg-amber-100 text-amber-800';
  return 'bg-[#edf5ff] text-[#285082]';
}

function leadMatchesSearch(lead: PipelineCandidate, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  const qDigits = q.replace(/\D/g, '');
  const { effectiveEmail } = readPipelineCandidateEmail(lead);
  const { effectivePhone } = readPipelineCandidatePhone(lead);
  const phoneDigits = effectivePhone.replace(/\D/g, '');
  const name = String(lead.full_name || '').toLowerCase();
  const email = String(lead.email || effectiveEmail || '').toLowerCase();
  return (
    name.includes(q) ||
    email.includes(q) ||
    effectiveEmail.toLowerCase().includes(q) ||
    (qDigits.length >= 3 && phoneDigits.includes(qDigits)) ||
    effectivePhone.toLowerCase().includes(q)
  );
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

type Props = {
  candidates: PipelineCandidate[];
  batchGroups: LeadBatchGroup[];
  latestByCandidate: Map<string, PipelineCallRecord>;
  callsByCandidate: Map<string, number>;
  tone: Tone;
  loading?: boolean;
  fullPage?: boolean;
};

const LeadManagerAllLeadsTable: React.FC<Props> = ({
  candidates,
  batchGroups,
  latestByCandidate,
  callsByCandidate,
  tone,
  loading = false,
  fullPage = false,
}) => {
  const navigate = useNavigate();
  const [search, setSearch] = React.useState('');
  const [sortKey, setSortKey] = React.useState<SortKey>('name');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');

  const packByCandidateId = React.useMemo(() => {
    const map = new Map<string, { title: string; key: string }>();
    for (const group of batchGroups) {
      for (const item of group.items) {
        map.set(item.id, { title: group.title, key: group.key });
      }
    }
    return map;
  }, [batchGroups]);

  const rows = React.useMemo(() => {
    const filtered = candidates.filter((lead) => leadMatchesSearch(lead, search));
    const enriched = filtered.map((lead) => {
      const pack = packByCandidateId.get(lead.id);
      const latest = latestByCandidate.get(lead.id);
      const disposition = latest?.disposition || 'Not contacted';
      const { effectiveEmail } = readPipelineCandidateEmail(lead);
      const { effectivePhone } = readPipelineCandidatePhone(lead);
      return {
        lead,
        packTitle: pack?.title || '—',
        packKey: pack?.key || getCandidateBatchGroupKey(lead),
        disposition,
        calls: callsByCandidate.get(lead.id) || 0,
        effectiveEmail: effectiveEmail || '—',
        effectivePhone: effectivePhone || '—',
        assignedAt: lead.assigned_at || lead.created_at,
      };
    });

    enriched.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = compareStrings(a.lead.full_name || '', b.lead.full_name || '');
          break;
        case 'email':
          cmp = compareStrings(a.effectiveEmail, b.effectiveEmail);
          break;
        case 'phone':
          cmp = compareStrings(a.effectivePhone, b.effectivePhone);
          break;
        case 'pack':
          cmp = compareStrings(a.packTitle, b.packTitle);
          break;
        case 'disposition':
          cmp = compareStrings(a.disposition, b.disposition);
          break;
        case 'calls':
          cmp = a.calls - b.calls;
          break;
        case 'assigned':
          cmp = new Date(a.assignedAt).getTime() - new Date(b.assignedAt).getTime();
          break;
        default:
          cmp = 0;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return enriched;
  }, [candidates, search, packByCandidateId, latestByCandidate, callsByCandidate, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'assigned' || key === 'calls' ? 'desc' : 'asc');
    }
  };

  const openPackDialer = (packKey: string, packTitle: string) => {
    saveDialQueueIntent({ batchKey: packKey, batchTitle: packTitle, startMode: 'resume' });
    navigate(`/pipeline/call?batch=${encodeURIComponent(packKey)}&mode=resume`);
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const thClass =
    'cursor-pointer select-none whitespace-nowrap border-b border-[#d4e4f6] bg-[#eef4fc] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[#4b6d95] hover:bg-[#e4eef9]';

  return (
    <section className={`rounded-2xl border p-4 md:p-5 ${tone.glassPanel} ${fullPage ? 'min-h-[calc(100vh-280px)]' : ''}`}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={`text-base font-semibold ${tone.panelTitle}`}>My assigned leads</p>
          <p className={`text-sm ${tone.panelMuted}`}>
            Search by name, email, or phone. Every lead HR assigned to you appears here.
          </p>
        </div>
        <p className={`text-sm font-medium ${tone.panelLabel}`}>
          Showing {rows.length} of {candidates.length} lead{candidates.length === 1 ? '' : 's'}
        </p>
      </div>

      <label className={`mb-4 block text-sm font-medium ${tone.panelLabel}`}>
        Search leads
        <div className={`relative mt-1.5 ${fullPage ? 'max-w-2xl' : 'max-w-xl'}`}>
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b84a8]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, email, or phone number"
            autoFocus={fullPage}
            className={`w-full rounded-xl border py-3 pl-10 pr-3 text-sm ${tone.input}`}
          />
        </div>
      </label>

      <div className={`overflow-auto rounded-xl border border-[#d4e4f6] ${fullPage ? 'max-h-[calc(100vh-400px)]' : ''}`}>
        <table className="min-w-[1100px] w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className={thClass} onClick={() => toggleSort('name')}>
                Name{sortIndicator('name')}
              </th>
              <th className={thClass} onClick={() => toggleSort('email')}>
                Email{sortIndicator('email')}
              </th>
              <th className={thClass} onClick={() => toggleSort('phone')}>
                Phone{sortIndicator('phone')}
              </th>
              <th className={thClass} onClick={() => toggleSort('pack')}>
                Lead pack{sortIndicator('pack')}
              </th>
              <th className={thClass} onClick={() => toggleSort('disposition')}>
                Last outcome{sortIndicator('disposition')}
              </th>
              <th className={`${thClass} text-right`} onClick={() => toggleSort('calls')}>
                Calls{sortIndicator('calls')}
              </th>
              <th className={thClass} onClick={() => toggleSort('assigned')}>
                Assigned{sortIndicator('assigned')}
              </th>
              <th className="border-b border-[#d4e4f6] bg-[#eef4fc] px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-[#4b6d95]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className={`px-3 py-12 text-center ${tone.panelMuted}`}>
                  Loading leads…
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={8} className={`px-3 py-12 text-center ${tone.panelMuted}`}>
                  {search.trim() ? 'No leads match your search.' : 'No assigned leads yet.'}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr
                  key={row.lead.id}
                  className={`border-b border-[#edf3fa] ${index % 2 === 0 ? 'bg-white' : 'bg-[#fafcff]'} hover:bg-[#f0f6ff]`}
                >
                  <td className="whitespace-nowrap px-3 py-2 font-semibold text-[#0B1B34]">
                    {row.lead.full_name || 'Unknown'}
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-[#4b6d95]" title={row.effectiveEmail}>
                    {row.effectiveEmail}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-[#4b6d95]">
                    {row.effectivePhone}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-[#4b6d95]" title={row.packTitle}>
                    {row.packTitle}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${dispositionClass(row.disposition)}`}
                    >
                      {row.disposition}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#4b6d95]">{row.calls}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[#6b84a8]">
                    {formatDateCanadaEastern(row.assignedAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      {row.effectivePhone !== '—' && (
                        <a
                          href={`tel:${row.effectivePhone.replace(/[^\d+]/g, '')}`}
                          className="inline-flex rounded-lg border border-[#c8ddf4] bg-white p-1.5 text-[#285082] hover:bg-[#eef6ff]"
                          title="Call number"
                        >
                          <Phone size={13} />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => openPackDialer(row.packKey, row.packTitle)}
                        className="inline-flex rounded-lg border border-[#c8ddf4] bg-white p-1.5 text-[#285082] hover:bg-[#eef6ff]"
                        title="Open pack in dialer"
                      >
                        <ExternalLink size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default LeadManagerAllLeadsTable;
