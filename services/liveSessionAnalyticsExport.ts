import { formatDateTimeCanadaEastern } from './dateDisplay';
import type {
  LiveSessionBookingRow,
  LiveSessionDateGrouping,
  LiveSessionOutcomeStatus,
  LiveSessionRecruiterProfile,
  LiveSessionSummaryRow,
} from './liveSessionRecruiterAnalytics';

const OUTCOME_LABEL: Record<LiveSessionOutcomeStatus, string> = {
  attended: 'Showed',
  no_show: 'No show',
  scheduled: 'Scheduled',
  pending: 'Pending',
};

export type LiveSessionAnalyticsTotals = {
  booked: number;
  showed: number;
  noShow: number;
  scheduled: number;
  pending: number;
  showRate: number;
  coins: number;
};

export type LiveSessionAnalyticsExportBundle = {
  generatedAt: string;
  loadedAt: string | null;
  periodLabel: string;
  periodSinceYmd: string;
  periodUntilYmd: string;
  dataWindowSinceYmd: string;
  dataWindowUntilYmd: string;
  dateGrouping: LiveSessionDateGrouping;
  filtersLabel: string;
  totals: LiveSessionAnalyticsTotals;
  bookings: LiveSessionBookingRow[];
  sessions: LiveSessionSummaryRow[];
  recruiters: LiveSessionRecruiterProfile[];
};

function csvCell(value: unknown): string {
  const text = String(value ?? '').replace(/"/g, '""');
  return `"${text}"`;
}

function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatZoomTime(value: string | null): string {
  if (!value) return '';
  return formatDateTimeCanadaEastern(value);
}

function bookingExportRow(b: LiveSessionBookingRow): string[] {
  return [
    b.recruiterName,
    b.candidateName,
    b.candidateEmail,
    b.candidatePhone,
    formatDateTimeCanadaEastern(b.bookedAt),
    b.bookedYmd,
    b.sessionDateLabel,
    OUTCOME_LABEL[b.outcome],
    formatZoomTime(b.zoomJoinAt),
    formatZoomTime(b.zoomLeaveAt),
    b.watchMinutes != null ? String(b.watchMinutes) : '',
    b.matchMethod || '',
    b.calendlyNoShow === null ? '' : b.calendlyNoShow ? 'yes' : 'no',
    b.coinsEarned > 0 ? String(b.coinsEarned) : '0',
  ];
}

const BOOKING_EXPORT_HEADERS = [
  'Caller',
  'Candidate',
  'Email',
  'Phone',
  'Booked at',
  'Booked date',
  'Session date',
  'Outcome',
  'Entry',
  'Exit',
  'Watch time (min)',
  'Match method',
  'Calendly no-show',
  'Paz Coins',
];

export function buildLiveSessionFiltersLabel(input: {
  selectedRecruiterLabel: string | null;
  outcomeFilter: LiveSessionOutcomeStatus | 'all';
  sessionDateFilter: string | 'all';
  searchQuery: string;
}): string {
  const parts: string[] = [];
  if (input.selectedRecruiterLabel) parts.push(`Caller: ${input.selectedRecruiterLabel}`);
  if (input.outcomeFilter !== 'all') parts.push(`Outcome: ${OUTCOME_LABEL[input.outcomeFilter]}`);
  if (input.sessionDateFilter !== 'all') {
    parts.push(`Session: ${input.sessionDateFilter === 'unknown' ? 'Unmatched' : input.sessionDateFilter}`);
  }
  if (input.searchQuery.trim()) parts.push(`Search: ${input.searchQuery.trim()}`);
  return parts.length ? parts.join(' · ') : 'None (all rows in period)';
}

export function exportLiveSessionAnalyticsCsv(bundle: LiveSessionAnalyticsExportBundle): void {
  const lines = [
    BOOKING_EXPORT_HEADERS.map(csvCell).join(','),
    ...bundle.bookings.map((b) => bookingExportRow(b).map(csvCell).join(',')),
  ];
  downloadTextFile(`live-session-stats-${exportStamp()}.csv`, lines.join('\n'), 'text/csv;charset=utf-8');
}

export async function exportLiveSessionAnalyticsPdf(bundle: LiveSessionAnalyticsExportBundle): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });
  const margin = 36;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - margin * 2;
  let y = margin;

  const newPage = (need: number) => {
    if (y + need <= pageH - margin) return;
    doc.addPage();
    y = margin;
  };

  const line = (text: string, size = 8, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const wrapped = doc.splitTextToSize(text, maxW);
    newPage(wrapped.length * (size + 3));
    doc.text(wrapped, margin, y);
    y += wrapped.length * (size + 3);
  };

  line('Live session bookings', 14, true);
  y += 4;

  if (!bundle.bookings.length) {
    line('No rows match the current filters.', 10);
    doc.save(`live-session-stats-${exportStamp()}.pdf`);
    return;
  }

  for (const b of bundle.bookings) {
    const watch =
      b.watchMinutes != null
        ? `${b.watchMinutes} min`
        : b.zoomJoinAt || b.zoomLeaveAt
          ? '—'
          : '';
    line(
      [
        b.recruiterName,
        b.candidateName,
        b.candidateEmail || b.candidatePhone || '—',
        formatDateTimeCanadaEastern(b.bookedAt),
        b.sessionDateLabel,
        OUTCOME_LABEL[b.outcome],
        b.zoomJoinAt ? `in ${formatZoomTime(b.zoomJoinAt)}` : '',
        b.zoomLeaveAt ? `out ${formatZoomTime(b.zoomLeaveAt)}` : '',
        watch ? `watch ${watch}` : '',
        b.coinsEarned > 0 ? `+${b.coinsEarned} coins` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      8,
    );
  }

  doc.save(`live-session-stats-${exportStamp()}.pdf`);
}
