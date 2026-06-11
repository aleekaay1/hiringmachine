import { jsPDF } from 'jspdf';
import type {
  RecruiterReportBundle,
  ReportCallRow,
  ReportEmailRow,
  ReportLiveSessionRow,
  ReportWebinarRow,
  StaffReportCard,
} from './reportsService';

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

export function exportTeamSummariesCsv(cards: StaffReportCard[], rangeLabel: string): void {
  const headers = [
    'Name',
    'Email',
    'Role',
    'Calls',
    'Call booked',
    'Webinar booked',
    'Webinar shows',
    'Live booked',
    'Paz coins',
    'Range',
  ];
  const lines = cards.map((card) =>
    [
      card.profile.full_name || '',
      card.profile.email || '',
      card.profile.role,
      card.summary.totalCalls,
      card.summary.bookedCalls,
      card.summary.webinarBooked,
      card.summary.webinarShowed,
      card.summary.liveBooked,
      card.summary.pazCoins,
      rangeLabel,
    ]
      .map(csvCell)
      .join(','),
  );
  downloadTextFile(
    `team-reports-${new Date().toISOString().slice(0, 10)}.csv`,
    [headers.map(csvCell).join(','), ...lines].join('\n'),
    'text/csv;charset=utf-8',
  );
}

function tableSectionCsv(title: string, headers: string[], rows: string[][]): string {
  const lines = [title, headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return lines.join('\n');
}

export function exportRecruiterReportCsv(report: RecruiterReportBundle): void {
  const name = (report.profile.full_name || report.profile.email || 'recruiter').replace(/[^a-z0-9_-]+/gi, '_');
  const sections: string[] = [
    `Recruiter report,${csvCell(report.profile.full_name || report.profile.email)}`,
    `Range,${csvCell(report.range.label)}`,
    `Generated,${csvCell(report.generatedAt)}`,
    '',
    tableSectionCsv(
      'Summary',
      ['Metric', 'Value'],
      [
        ['Dial activity (logs)', String(report.summary.totalCalls)],
        ['Webinar booked', String(report.summary.webinarBooked)],
        ['Webinar shows', String(report.summary.webinarShowed)],
        ['Emails sent', String(report.summary.emailsSent)],
        ['Email replies', String(report.summary.emailReplies)],
        ['Paz coins', String(report.summary.pazCoins)],
      ],
    ),
    '',
    tableSectionCsv(
      'Calls',
      ['Disposed at', 'Disposition', 'Booked subtype', 'Candidate', 'Phone', 'Comment'],
      report.calls.map((r: ReportCallRow) => [
        r.disposedAt,
        r.disposition,
        r.bookedSubtype,
        r.candidateId,
        r.dialedNumber,
        r.comment || '',
      ]),
    ),
    '',
    tableSectionCsv(
      'Webinars booked',
      ['Scheduled on', 'Session', 'Candidate', 'Email', 'Phone', 'Team', 'Watched', 'Showed', 'Tag'],
      report.webinarsBooked.map((r: ReportWebinarRow) => [
        r.scheduledOnYmd,
        r.sessionYmd,
        r.candidateName,
        r.email,
        r.phone,
        r.team,
        r.watched ? 'yes' : 'no',
        r.showed ? 'yes' : 'no',
        r.customField,
      ]),
    ),
    '',
    tableSectionCsv(
      'Webinar shows',
      ['Session', 'Scheduled on', 'Candidate', 'Email', 'Phone', 'Minutes', 'Tag'],
      report.webinarShows.map((r: ReportWebinarRow) => [
        r.sessionYmd,
        r.scheduledOnYmd,
        r.candidateName,
        r.email,
        r.phone,
        String(r.watchMinutes),
        r.customField,
      ]),
    ),
    '',
    tableSectionCsv(
      'Live sessions',
      ['Disposed at', 'Candidate email', 'Phone', 'Session date', 'Attended'],
      report.liveSessions.map((r: ReportLiveSessionRow) => [
        r.disposedAt,
        r.candidateEmail,
        r.candidatePhone,
        r.sessionDate,
        r.attended ? 'yes' : 'no',
      ]),
    ),
    '',
    tableSectionCsv(
      'Emails',
      ['At', 'Direction', 'Subject', 'To/From', 'Status'],
      report.emails.map((r: ReportEmailRow) => [r.at, r.direction, r.subject, r.toOrFrom, r.status]),
    ),
  ];

  downloadTextFile(`recruiter-report-${name}.csv`, sections.join('\n'), 'text/csv;charset=utf-8');
}

export function exportRecruiterReportPdf(report: RecruiterReportBundle): void {
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

  line('Recruiter performance report', 16, true);
  line(`${report.profile.full_name || '—'} · ${report.profile.email || ''} · ${report.profile.role}`, 11);
  line(`Range: ${report.range.label}`, 10);
  line(`Generated: ${new Date(report.generatedAt).toLocaleString()}`, 9);
  y += 8;

  const metrics: Array<[string, string]> = [
    ['Total calls', String(report.summary.totalCalls)],
    ['Booked calls', String(report.summary.bookedCalls)],
    ['Webinar booked', String(report.summary.webinarBooked)],
    ['Webinar shows', String(report.summary.webinarShowed)],
    ['Live booked', String(report.summary.liveBooked)],
    ['Live shows', String(report.summary.liveShowed)],
    ['Emails sent', String(report.summary.emailsSent)],
    ['Email replies', String(report.summary.emailReplies)],
    ['Paz coins', String(report.summary.pazCoins)],
  ];

  line('Summary', 12, true);
  for (const [label, value] of metrics) {
    line(`${label}: ${value}`, 10);
  }
  y += 6;

  const section = (title: string, rows: string[][]) => {
    line(title, 12, true);
    if (!rows.length) {
      line('No rows in this period.', 9);
      return;
    }
    for (const row of rows.slice(0, 80)) {
      line(row.join(' · '), 8);
    }
    if (rows.length > 80) line(`… and ${rows.length - 80} more rows (export CSV for full detail).`, 8);
    y += 4;
  };

  section(
    'Calls',
    report.calls.map((r) => [
      new Date(r.disposedAt).toLocaleString(),
      r.disposition,
      r.bookedSubtype || '—',
      r.dialedNumber,
    ]),
  );
  section(
    'Webinars booked',
    report.webinarsBooked.map((r) => [r.scheduledOnYmd, r.candidateName, r.email, r.phone || '—', r.team]),
  );
  section(
    'Webinar shows',
    report.webinarShows.map((r) => [r.sessionYmd, r.candidateName, r.email, r.phone || '—', `${r.watchMinutes} min`]),
  );
  section(
    'Live sessions',
    report.liveSessions.map((r) => [
      r.sessionDate,
      r.candidateEmail,
      r.candidatePhone || '—',
      r.attended ? 'attended' : 'no show',
    ]),
  );

  const filename = `recruiter-report-${(report.profile.full_name || 'staff').replace(/[^a-z0-9_-]+/gi, '_')}.pdf`;
  doc.save(filename);
}
