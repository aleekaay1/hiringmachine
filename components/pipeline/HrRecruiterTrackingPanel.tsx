import React from 'react';
import { BarChart3, ChevronDown, Loader2, Undo2 } from 'lucide-react';
import LeadBatchAccordion from './LeadBatchAccordion';
import { formatDateTimeCanadaEastern } from '../../services/dateDisplay';
import { groupHrLeadsByBatchId, type LeadBatchGroup } from '../../services/pipelineLeadGrouping';
import type {
  HrRecruiterLeadRow,
  HrRecruiterOverview,
  PipelineLeadBatch,
} from '../../services/pipelineHrLeadsService';

type HrRecruiterTrackingPanelProps = {
  recruiters: HrRecruiterOverview[];
  batches: PipelineLeadBatch[];
  selectedBatchId: string;
  loading: boolean;
  onLoadRecruiterLeads: (userId: string) => Promise<HrRecruiterLeadRow[]>;
  onRetractBatch?: (batchId: string, assigneeUserId: string, batchTitle: string, leadCount: number) => Promise<void>;
  retracting?: boolean;
};

function dispositionBadgeClass(disposition: string | null): string {
  const d = String(disposition || '').trim().toLowerCase();
  if (!d) return 'bg-slate-100 text-slate-600';
  if (d === 'booked') return 'bg-violet-100 text-violet-800';
  if (d === 'no answer') return 'bg-amber-100 text-amber-800';
  if (d === 'callback requested') return 'bg-sky-100 text-sky-800';
  if (d === 'not interested' || d === 'do not call') return 'bg-red-100 text-red-700';
  if (d === 'voicemail left' || d === 'busy / line busy') return 'bg-orange-100 text-orange-800';
  return 'bg-[#edf5ff] text-[#285082]';
}

function StatPill({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${accent || 'bg-slate-100 text-slate-700'}`}>
      {label}: {value}
    </span>
  );
}

function DispositionBars({ counts, worked }: { counts: HrRecruiterOverview['disposition_counts']; worked: number }) {
  const items = [
    { key: 'booked', label: 'Booked', value: counts.booked, color: 'bg-violet-500' },
    { key: 'no_answer', label: 'No answer', value: counts.no_answer, color: 'bg-amber-500' },
    { key: 'callback_requested', label: 'Callback', value: counts.callback_requested, color: 'bg-sky-500' },
    { key: 'voicemail_left', label: 'Voicemail', value: counts.voicemail_left, color: 'bg-orange-400' },
    { key: 'not_interested', label: 'Not interested', value: counts.not_interested, color: 'bg-red-400' },
    { key: 'connected', label: 'Connected', value: counts.connected, color: 'bg-emerald-500' },
  ].filter((row) => row.value > 0);

  if (!worked || !items.length) {
    return <p className="text-[11px] text-[#6b84a8]">No activity yet.</p>;
  }

  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item.key} className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-[10px] text-[#4b6d95]">{item.label}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#e8f1fb]">
            <div
              className={`h-full rounded-full ${item.color}`}
              style={{ width: `${Math.max(4, Math.round((item.value / worked) * 100))}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right text-[10px] font-semibold text-[#0B1B34]">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

const HrRecruiterTrackingPanel: React.FC<HrRecruiterTrackingPanelProps> = ({
  recruiters,
  batches,
  selectedBatchId,
  loading,
  onLoadRecruiterLeads,
  onRetractBatch,
  retracting = false,
}) => {
  const [expandedUserId, setExpandedUserId] = React.useState<string | null>(null);
  const [leadsByUser, setLeadsByUser] = React.useState<Map<string, HrRecruiterLeadRow[]>>(() => new Map());
  const [loadingUserId, setLoadingUserId] = React.useState<string | null>(null);
  const [expandedBatchKeys, setExpandedBatchKeys] = React.useState<Set<string>>(() => new Set());
  const [detailError, setDetailError] = React.useState<string | null>(null);

  const toggleRecruiter = async (userId: string) => {
    if (expandedUserId === userId) {
      setExpandedUserId(null);
      return;
    }
    setExpandedUserId(userId);
    setDetailError(null);
    if (leadsByUser.has(userId)) return;

    setLoadingUserId(userId);
    try {
      const leads = await onLoadRecruiterLeads(userId);
      setLeadsByUser((prev) => new Map(prev).set(userId, leads));
      const groups = groupHrLeadsByBatchId(leads, batches);
      if (groups[0]) {
        setExpandedBatchKeys(new Set([groups[0].key]));
      }
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingUserId(null);
    }
  };

  React.useEffect(() => {
    setLeadsByUser(new Map());
    setExpandedUserId(null);
    setExpandedBatchKeys(new Set());
  }, [selectedBatchId]);

  const buildLeadGroups = (leads: HrRecruiterLeadRow[]): LeadBatchGroup<HrRecruiterLeadRow>[] =>
    groupHrLeadsByBatchId(leads, batches).map((group) => {
      const notContacted = group.items.filter((lead) => !lead.latest_disposition).length;
      const booked = group.items.filter((lead) => String(lead.latest_disposition || '').toLowerCase() === 'booked').length;
      return {
        key: group.key,
        kind: 'hr_batch' as const,
        batchNumber: null,
        title: group.title,
        subtitle: `${group.items.length} leads`,
        sortTimestamp: group.sortTimestamp,
        items: group.items,
        newCount: notContacted,
        inProgressCount: group.items.length - notContacted - booked,
        doneCount: booked,
      };
    });

  if (loading && !recruiters.length) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#4b6d95]">
        <Loader2 size={16} className="animate-spin" />
        Loading…
      </div>
    );
  }

  if (!recruiters.length) {
    return <p className="py-8 text-center text-xs text-[#6b84a8]">No assigned leads.</p>;
  }

  return (
    <div className="space-y-2">
      {detailError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{detailError}</div>
      )}
      {recruiters.map((recruiter) => {
        const expanded = expandedUserId === recruiter.user_id;
        const workedPct = recruiter.assigned_count
          ? Math.round((recruiter.worked_count / recruiter.assigned_count) * 100)
          : 0;
        const leads = leadsByUser.get(recruiter.user_id) || [];
        const leadGroups = expanded && leads.length ? buildLeadGroups(leads) : [];

        return (
          <div key={recruiter.user_id} className="overflow-hidden rounded-xl border border-[#e3edf8] bg-[#fafcff]">
            <button
              type="button"
              onClick={() => void toggleRecruiter(recruiter.user_id)}
              className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left hover:bg-[#f4f8ff]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-[#0B1B34]">{recruiter.label}</p>
                  <StatPill label="Assigned" value={recruiter.assigned_count} accent="bg-[#edf5ff] text-[#285082]" />
                  <StatPill label="Not contacted" value={recruiter.not_contacted_count} />
                  <StatPill label="Worked" value={recruiter.worked_count} accent="bg-emerald-50 text-emerald-800" />
                  {recruiter.disposition_counts.booked > 0 && (
                    <StatPill label="Booked" value={recruiter.disposition_counts.booked} accent="bg-violet-100 text-violet-800" />
                  )}
                  {recruiter.disposition_counts.no_answer > 0 && (
                    <StatPill label="No answer" value={recruiter.disposition_counts.no_answer} accent="bg-amber-100 text-amber-800" />
                  )}
                </div>
                <p className="mt-1 text-[11px] text-[#6b84a8]">
                  {workedPct}% contacted
                  {recruiter.disposition_counts.callback_requested > 0
                    ? ` · ${recruiter.disposition_counts.callback_requested} callbacks pending`
                    : ''}
                </p>
              </div>
              <ChevronDown
                size={16}
                className={`mt-1 shrink-0 text-[#4b6d95] transition-transform ${expanded ? 'rotate-180' : ''}`}
              />
            </button>

            {expanded && (
              <div className="border-t border-[#e3edf8] px-3 py-3">
                {loadingUserId === recruiter.user_id && (
                  <div className="mb-3 flex items-center gap-2 text-xs text-[#4b6d95]">
                    <Loader2 size={14} className="animate-spin" />
                    Loading…
                  </div>
                )}

                <div className="mb-4 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-[#e3edf8] bg-white p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#0B1B34]">
                      <BarChart3 size={13} />
                      Disposition breakdown
                    </p>
                    <DispositionBars counts={recruiter.disposition_counts} worked={recruiter.worked_count} />
                  </div>
                  <div className="rounded-xl border border-[#e3edf8] bg-white p-3">
                    <p className="mb-2 text-xs font-semibold text-[#0B1B34]">Summary</p>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      <dt className="text-[#6b84a8]">Assigned</dt>
                      <dd className="font-semibold text-[#0B1B34]">{recruiter.assigned_count}</dd>
                      <dt className="text-[#6b84a8]">Not contacted</dt>
                      <dd className="font-semibold text-[#0B1B34]">{recruiter.not_contacted_count}</dd>
                      <dt className="text-[#6b84a8]">Contact rate</dt>
                      <dd className="font-semibold text-[#0B1B34]">{workedPct}%</dd>
                      <dt className="text-[#6b84a8]">Booked</dt>
                      <dd className="font-semibold text-violet-700">{recruiter.disposition_counts.booked}</dd>
                      <dt className="text-[#6b84a8]">No answer</dt>
                      <dd className="font-semibold text-amber-700">{recruiter.disposition_counts.no_answer}</dd>
                      <dt className="text-[#6b84a8]">Callbacks</dt>
                      <dd className="font-semibold text-sky-700">{recruiter.disposition_counts.callback_requested}</dd>
                      <dt className="text-[#6b84a8]">Not interested</dt>
                      <dd className="font-semibold text-red-700">{recruiter.disposition_counts.not_interested}</dd>
                    </dl>
                  </div>
                </div>

                {leadGroups.length > 0 && (
                  <div className="max-h-[36vh] overflow-auto">
                    <p className="mb-2 text-xs font-semibold text-[#0B1B34]">Leads by batch</p>
                    {onRetractBatch && leadGroups.some((group) => group.key !== 'unbatched') && (
                      <div className="mb-3 flex flex-wrap gap-1.5">
                        {leadGroups
                          .filter((group) => group.key !== 'unbatched')
                          .map((group) => (
                            <button
                              key={group.key}
                              type="button"
                              disabled={retracting}
                              onClick={() => void onRetractBatch(group.key, recruiter.user_id, group.title, group.items.length)}
                              className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-white px-2 py-1 text-[10px] font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                            >
                              <Undo2 size={11} />
                              Retract {group.title}
                            </button>
                          ))}
                      </div>
                    )}
                    <LeadBatchAccordion
                      groups={leadGroups}
                      expandedKeys={expandedBatchKeys}
                      onToggle={(key) => {
                        setExpandedBatchKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        });
                      }}
                      compact
                      emptyMessage="No leads."
                      renderItem={(lead) => (
                        <div key={lead.id} className="rounded-lg border border-[#edf3fa] bg-white px-2 py-2 text-xs">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold text-[#0B1B34]">{lead.full_name}</p>
                              <p className="text-[#4b6d95]">{lead.email || '—'} · {lead.phone || '—'}</p>
                              <p className="mt-0.5 text-[10px] text-[#6b84a8]">
                                Assigned {lead.assigned_at ? formatDateTimeCanadaEastern(lead.assigned_at) : '—'}
                                {lead.call_count > 1 ? ` · ${lead.call_count} calls` : ''}
                              </p>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${dispositionBadgeClass(lead.latest_disposition)}`}>
                              {lead.latest_disposition || 'Not contacted'}
                            </span>
                          </div>
                        </div>
                      )}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default HrRecruiterTrackingPanel;
