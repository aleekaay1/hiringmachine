import React from 'react';
import { CalendarCheck, Mail, Phone, UserCheck, Video } from 'lucide-react';
import {
  buildCandidateStatsRange,
  computeCandidateActivityStats,
  type CandidateStatsPreset,
} from '../../services/candidateActivityStats';
import type { LiveSessionRegistrantRow } from '../../services/liveSessionBookedOutcomes';
import type { PipelineCallRecord, PipelineCandidate } from '../../services/pipelineService';

type CandidateActivityStatsPanelTone = {
  subtle: string;
  panelTitle: string;
  panelMuted: string;
  panelLabel: string;
  input: string;
};

type CandidateActivityStatsPanelProps = {
  candidate: PipelineCandidate;
  records: PipelineCallRecord[];
  registrants: LiveSessionRegistrantRow[];
  emailsSent?: number;
  tone: CandidateActivityStatsPanelTone;
};

const PRESETS: { id: CandidateStatsPreset; label: string }[] = [
  { id: 'friday_week', label: 'This week' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'all', label: 'All time' },
];

function StatTile({
  icon: Icon,
  label,
  value,
  tone,
  accent,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number;
  tone: CandidateActivityStatsPanelTone;
  accent?: string;
}) {
  return (
    <div className={`rounded-xl border p-3 ${tone.subtle}`}>
      <div className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>
        <Icon size={12} className={accent} aria-hidden />
        {label}
      </div>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tone.panelTitle}`}>{value}</p>
    </div>
  );
}

const CandidateActivityStatsPanel: React.FC<CandidateActivityStatsPanelProps> = ({
  candidate,
  records,
  registrants,
  emailsSent = 0,
  tone,
}) => {
  const [preset, setPreset] = React.useState<CandidateStatsPreset>('friday_week');

  const stats = React.useMemo(() => {
    const range = buildCandidateStatsRange(preset);
    return computeCandidateActivityStats({
      candidate,
      records,
      registrants,
      emailsSent,
      range,
    });
  }, [candidate, records, registrants, emailsSent, preset]);

  return (
    <section className={`rounded-2xl border p-4 ${tone.subtle}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${tone.panelLabel}`}>Candidate stats</p>
          <p className={`text-xs ${tone.panelMuted}`}>{stats.label}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPreset(item.id)}
              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                preset === item.id
                  ? 'border-[#7eb3e7] bg-[#e8f3ff] text-[#285082]'
                  : tone.input
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile icon={Phone} label="Calls" value={stats.totalCalls} tone={tone} />
        <StatTile icon={Video} label="Webinar booked" value={stats.bookedWebinar} tone={tone} />
        <StatTile icon={UserCheck} label="Webinar shows" value={stats.showedWebinar} tone={tone} accent="text-violet-600" />
        <StatTile icon={CalendarCheck} label="Live booked" value={stats.bookedLive} tone={tone} accent="text-sky-600" />
        <StatTile icon={UserCheck} label="Live shows" value={stats.showedLive} tone={tone} accent="text-emerald-600" />
        <StatTile icon={Mail} label="Emails sent" value={stats.emailsSent} tone={tone} />
      </div>
    </section>
  );
};

export default CandidateActivityStatsPanel;
