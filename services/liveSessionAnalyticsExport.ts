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

function tableSectionCsv(title: string, headers: string[], rows: string[][]): string {
  return [title, headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n');
}

function dateGroupingLabel(grouping: LiveSessionDateGrouping): string {
  return grouping === 'session' ? 'Session date (Calendly)' : 'Booking date (call disposition)';
}

function exportStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

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
  const sections: string[] = [
    'Live session performance report',
    `Period,${csvCell(bundle.periodLabel)}`,
    `Period range,${csvCell(`${bundle.periodSinceYmd} → ${bundle.periodUntilYmd}`)}`,
    `Data window,${csvCell(`${bundle.dataWindowSinceYmd} → ${bundle.dataWindowUntilYmd}`)}`,
    `Date grouping,${csvCell(dateGroupingLabel(bundle.dateGrouping))}`,
    `Active filters,${csvCell(bundle.filtersLabel)}`,
    `Generated,${csvCell(bundle.generatedAt)}`,
    `Last loaded,${csvCell(bundle.loadedAt || '—')}`,
    '',
    tableSectionCsv(
      'Summary (filtered)',
      ['Booked', 'Showed', 'No show', 'Scheduled', 'Pending', 'Show rate %', 'Paz Coins'],
      [
        [
          String(bundle.totals.booked),
          String(bundle.totals.showed),
          String(bundle.totals.noShow),
          String(bundle.totals.scheduled),
          String(bundle.totals.pending),
          String(bundle.totals.showRate),
          String(bundle.totals.coins),
        ],
      ],
    ),
    '',
    tableSectionCsv(
      'By caller',
      ['Caller', 'Booked', 'Showed', 'No show', 'Scheduled', 'Pending', 'Show rate %', 'Paz Coins'],
      bundle.recruiters.map((r) => [
        r.displayName,
        String(r.booked),
        String(r.showed),
        String(r.noShow),
        String(r.scheduled),
        String(r.pending),
        String(r.showRatePct),
        String(r.coinsEarned),
      ]),
    ),
    '',
    tableSectionCsv(
      'By session',
      ['Session date', 'Booked', 'Showed', 'No show', 'Scheduled', 'Pending', 'Show rate %'],
      bundle.sessions.map((s) => [
        s.sessionDateLabel,
        String(s.booked),
        String(s.showed),
        String(s.noShow),
        String(s.scheduled),
        String(s.pending),
        String(s.showRatePct),
      ]),
    ),
    '',
    tableSectionCsv(
      'Bookings (filtered)',
      [
        'Caller',
        'Candidate',
        'Email',
        'Phone',
        'Booked at',
        'Booked date',
        'Session date',
        'Outcome',
        'Match method',
        'Calendly no-show',
        'Paz Coins',
        'Call record ID',
        'Candidate ID',
      ],
      bundle.bookings.map((b) => [
        b.recruiterName,
        b.candidateName,
        b.candidateEmail,
        b.candidatePhone,
        formatDateTimeCanadaEastern(b.bookedAt),
        b.bookedYmd,
        b.sessionDateLabel,
        OUTCOME_LABEL[b.outcome],
        b.matchMethod || '',
        b.calendlyNoShow === null ? '' : b.calendlyNoShow ? 'yes' : 'no',
        b.coinsEarned > 0 ? String(b.coinsEarned) : '0',
        b.callRecordId,
        b.candidateId,
      ]),
    ),
  ];

  downloadTextFile(`live-session-stats-${exportStamp()}.csv`, sections.join('\n'), 'text/csv;charset=utf-8');
}

export async function exportLiveSessionAnalyticsPdf(bundle: LiveSessionAnalyticsExportBundle): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 48;
  const pageW = doc.internal.pageSize.getWidth();
  const maxW = pageW - margin * 2;
  let y = margin;

  const newPage = (need: number) => {
    if (y + need <= doc.internal.pageSize.getHeight() - margin) return;
    doc.addPage();
    y = margin;
  };

  const line = (text: string, size = 10, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const wrapped = doc.splitTextToSize(text, maxW);
    newPage(wrapped.length * (size + 4));
    doc.text(wrapped, margin, y);
    y += wrapped.length * (size + 4);
  };

  line('Live session performance report', 16, true);
  line(`Period: ${bundle.periodLabel} (${bundle.periodSinceYmd} → ${bundle.periodUntilYmd})`, 10);
  line(`Data window: ${bundle.dataWindowSinceYmd} → ${bundle.dataWindowUntilYmd}`, 9);
  line(`Date grouping: ${dateGroupingLabel(bundle.dateGrouping)}`, 9);
  line(`Filters: ${bundle.filtersLabel}`, 9);
  line(`Generated: ${new Date(bundle.generatedAt).toLocaleString()}`, 9);
  if (bundle.loadedAt) line(`Data loaded: ${new Date(bundle.loadedAt).toLocaleString()}`, 9);
  y += 6;

  line('Summary (filtered)', 12, true);
  const metrics: Array<[string, string]> = [
    ['Booked', String(bundle.totals.booked)],
    ['Showed', String(bundle.totals.showed)],
    ['No show', String(bundle.totals.noShow)],
    ['Scheduled', String(bundle.totals.scheduled)],
    ['Pending', String(bundle.totals.pending)],
    ['Show rate', `${bundle.totals.showRate}%`],
    ['Paz Coins', String(bundle.totals.coins)],
  ];
  for (const [label, value] of metrics) {
    line(`${label}: ${value}`, 10);
  }
  y += 6;

  const section = (title: string, rows: string[][]) => {
    line(title, 12, true);
    if (!rows.length) {
      line('No rows match the current filters.', 9);
      y += 4;
      return;
    }
    for (const row of rows) {
      line(row.join(' · '), 8);
    }
    y += 4;
  };

  section(
    'By caller',
    bundle.recruiters.map((r) => [
      r.displayName,
      `booked ${r.booked}`,
      `showed ${r.showed}`,
      `no show ${r.noShow}`,
      `rate ${r.showRatePct}%`,
      `coins ${r.coinsEarned}`,
    ]),
  );

  section(
    'By session',
    bundle.sessions.map((s) => [
      s.sessionDateLabel,
      `booked ${s.booked}`,
      `showed ${s.showed}`,
      `no show ${s.noShow}`,
      `rate ${s.showRatePct}%`,
    ]),
  );

  section(
    'Bookings',
    bundle.bookings.map((b) => [
      b.recruiterName,
      b.candidateName,
      b.candidateEmail || b.candidatePhone || '—',
      formatDateTimeCanadaEastern(b.bookedAt),
      b.sessionDateLabel,
      OUTCOME_LABEL[b.outcome],
      b.coinsEarned > 0 ? `+${b.coinsEarned} coins` : '',
    ]),
  );

  if (bundle.bookings.length > 120) {
    line(`Full booking list (${bundle.bookings.length} rows) — use CSV export for complete detail.`, 8);
  }

  doc.save(`live-session-stats-${exportStamp()}.pdf`);
}
