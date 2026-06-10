import React from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  FileSpreadsheet,
  FileText,
  Mail,
  PhoneCall,
  RefreshCw,
  UserCheck,
  Video,
  CalendarCheck,
} from 'lucide-react';
import { Button } from '../components/UI';
import { useAdminSessionOnce } from '../components/reports/useAdminSessionOnce';
import { ReportDataTable } from '../components/reports/ReportDataTable';
import { ReportDateRangeBar } from '../components/reports/ReportDateRangeBar';
import { ReportExpandableSection } from '../components/reports/ReportExpandableSection';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';
import { listAllUserProfiles } from '../services/accessControl';
import {
  buildReportDateRange,
  isReportableRole,
  loadRecruiterReport,
  refreshReportSourcesFromRemote,
  type RecruiterReportBundle,
  type ReportDatePreset,
} from '../services/reportsService';
import { exportRecruiterReportCsv, exportRecruiterReportPdf } from '../services/reportsExport';
import {
  loadUserReportSnapshot,
  saveUserReportSnapshot,
} from '../services/reportsSnapshotCache';
import { torontoYmdFromDate } from '../services/webinarGeekDates';
import { profileInitials } from '../services/webinarGeekRecruiterAnalytics';

function formatIso(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return formatDateTimeCanadaEastern(ms);
}

function formatRefreshedAt(iso: string | null): string {
  if (!iso) return 'Not saved yet';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const ReportDetail: React.FC = () => {
  useAdminSessionOnce();
  const { userId } = useParams<{ userId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialPreset = (searchParams.get('preset') as ReportDatePreset) || 'friday_week';
  const [preset, setPreset] = React.useState<ReportDatePreset>(initialPreset);
  const [customSince, setCustomSince] = React.useState(
    () => searchParams.get('since') || torontoYmdFromDate(),
  );
  const [customUntil, setCustomUntil] = React.useState(
    () => searchParams.get('until') || torontoYmdFromDate(),
  );
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<RecruiterReportBundle | null>(null);
  const [openSections, setOpenSections] = React.useState<Set<string>>(new Set(['webinarBooked']));
  const [lastUpdated, setLastUpdated] = React.useState<string | null>(null);

  const range = React.useMemo(
    () =>
      buildReportDateRange(
        preset,
        preset === 'custom' ? { sinceYmd: customSince, untilYmd: customUntil } : undefined,
      ),
    [preset, customSince, customUntil],
  );

  React.useEffect(() => {
    const params = new URLSearchParams();
    params.set('preset', preset);
    if (preset === 'custom') {
      params.set('since', customSince);
      params.set('until', customUntil);
    }
    setSearchParams(params, { replace: true });
  }, [preset, customSince, customUntil, setSearchParams]);

  const loadReport = React.useCallback(
    async (opts?: { forceCompute?: boolean }) => {
      if (!userId) return;
      setLoading(true);
      setError(null);
      try {
        const profiles = await listAllUserProfiles();
        const profile = profiles.find((p) => p.user_id === userId);
        if (!profile || !isReportableRole(profile.role)) {
          throw new Error('Team member not found or not available for reports.');
        }

        if (!opts?.forceCompute) {
          const cached = await loadUserReportSnapshot(userId, range);
          if (!cached.tableMissing && cached.payload) {
            const bundle = cached.payload as RecruiterReportBundle;
            setReport(bundle);
            setLastUpdated(cached.fetchedAt);
            return;
          }
        }

        const bundle = await loadRecruiterReport(profile, range);
        const saved = await saveUserReportSnapshot(userId, range, bundle);
        setReport(bundle);
        setLastUpdated(saved.fetchedAt);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setReport(null);
      } finally {
        setLoading(false);
      }
    },
    [userId, range],
  );

  React.useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const toggleSection = (key: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const result = await refreshReportSourcesFromRemote();
      if (!result.ok) throw new Error(result.error || 'Refresh failed');
      await loadReport({ forceCompute: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const displayName = report?.profile.full_name || report?.profile.email?.split('@')[0] || 'Team member';

  return (
        <div className="mx-auto w-full min-w-0 max-w-5xl p-4 md:p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link
                to="/reports"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#2f6ea8] hover:underline"
              >
                <ArrowLeft size={14} aria-hidden />
                All reports
              </Link>
              <h1
                className="mt-2 text-2xl font-semibold text-[#0B1B34]"
                style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}
              >
                {displayName}
              </h1>
              {report && (
                <p className="text-sm text-[#5c7594]">
                  {report.profile.email} · {report.profile.role}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <div className="flex flex-wrap gap-2 justify-end">
                <Button
                  variant="outline"
                  disabled={!report}
                  onClick={() => report && exportRecruiterReportCsv(report)}
                >
                  <FileSpreadsheet size={15} className="mr-1" />
                  CSV
                </Button>
                <Button variant="outline" disabled={!report} onClick={() => report && exportRecruiterReportPdf(report)}>
                  <FileText size={15} className="mr-1" />
                  PDF
                </Button>
                <Button onClick={() => void handleRefresh()} disabled={refreshing}>
                  <RefreshCw size={15} className={refreshing ? 'mr-1 animate-spin' : 'mr-1'} />
                  Refresh data
                </Button>
              </div>
              <p className="text-[9px] text-[#8aa3be]">Saved {formatRefreshedAt(lastUpdated)}</p>
            </div>
          </div>

          <ReportDateRangeBar
            preset={preset}
            onPresetChange={setPreset}
            customSince={customSince}
            customUntil={customUntil}
            onCustomSince={setCustomSince}
            onCustomUntil={setCustomUntil}
            rangeLabel={range.label}
          />

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
          )}

          {loading && (
            <div className="rounded-2xl border border-[#dfeaf8] bg-white px-4 py-10 text-center text-sm text-[#5c7594]">
              Loading report…
            </div>
          )}

          {!loading && report && (
            <>
              <div className="rounded-2xl border border-[#d9e5f6] bg-white/90 p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#dff0ff] text-lg font-bold text-[#0B1B34]">
                    {profileInitials(displayName)}
                  </span>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-[#6d86a3]">Summary · {report.range.label}</p>
                    <p className="text-xs text-[#5c7594]">
                      Generated {new Date(report.generatedAt).toLocaleString()}
                      {report.dataSources.webinarFetchedAt && (
                        <> · Webinar cache {new Date(report.dataSources.webinarFetchedAt).toLocaleString()}</>
                      )}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: 'Webinar booked', value: report.summary.webinarBooked, icon: Video },
                    { label: 'Webinar shows', value: report.summary.webinarShowed, icon: UserCheck },
                    { label: 'Live booked', value: report.summary.liveBooked, icon: CalendarCheck },
                    { label: 'Live shows', value: report.summary.liveShowed, icon: UserCheck },
                    { label: 'Emails sent', value: report.summary.emailsSent, icon: Mail },
                    { label: 'Paz coins', value: report.summary.pazCoins, icon: FileText },
                    { label: 'Dial activity', value: report.summary.totalCalls, icon: PhoneCall },
                    { label: 'Email replies', value: report.summary.emailReplies, icon: Mail },
                  ].map((item) => {
                    const Icon = item.icon;
                    return (
                      <div key={item.label} className="rounded-xl border border-[#eef4fb] bg-[#f9fcff] px-3 py-2">
                        <p className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-[#6d86a3]">
                          <Icon size={12} aria-hidden />
                          {item.label}
                        </p>
                        <p className="text-xl font-bold tabular-nums text-[#0B1B34]">{item.value}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <ReportExpandableSection
                  title="Calls"
                  subtitle="Dispositions from pipeline call records"
                  count={report.calls.length}
                  open={openSections.has('calls')}
                  onToggle={() => toggleSection('calls')}
                >
                  <ReportDataTable
                    columns={[
                      { key: 'disposedAt', label: 'Disposed' },
                      { key: 'disposition', label: 'Disposition' },
                      { key: 'bookedSubtype', label: 'Booked type' },
                      { key: 'candidateId', label: 'Candidate ID' },
                      { key: 'dialedNumber', label: 'Phone' },
                      { key: 'comment', label: 'Comment' },
                    ]}
                    rows={report.calls.map((r) => ({
                      id: r.id,
                      disposedAt: formatIso(r.disposedAt),
                      disposition: r.disposition,
                      bookedSubtype: r.bookedSubtype || '—',
                      candidateId: r.candidateId,
                      dialedNumber: r.dialedNumber,
                      comment: r.comment || '—',
                    }))}
                  />
                </ReportExpandableSection>

                <ReportExpandableSection
                  title="Webinars booked"
                  subtitle="WebinarGeek rows scheduled in range (file tag ownership)"
                  count={report.webinarsBooked.length}
                  open={openSections.has('webinarBooked')}
                  onToggle={() => toggleSection('webinarBooked')}
                >
                  <ReportDataTable
                    columns={[
                      { key: 'scheduledOnYmd', label: 'Scheduled on' },
                      { key: 'sessionYmd', label: 'Session' },
                      { key: 'candidateName', label: 'Candidate' },
                      { key: 'email', label: 'Email' },
                      { key: 'team', label: 'Team' },
                      { key: 'watched', label: 'Watched' },
                      { key: 'customField', label: 'File tag' },
                    ]}
                    rows={report.webinarsBooked.map((r) => ({
                      id: r.id,
                      scheduledOnYmd: r.scheduledOnYmd,
                      sessionYmd: r.sessionYmd,
                      candidateName: r.candidateName,
                      email: r.email,
                      team: r.team,
                      watched: r.watched ? 'Yes' : 'No',
                      customField: r.customField,
                    }))}
                  />
                </ReportExpandableSection>

                <ReportExpandableSection
                  title="Webinar shows"
                  subtitle="Marked watched / half+ watch in range"
                  count={report.webinarShows.length}
                  open={openSections.has('webinarShows')}
                  onToggle={() => toggleSection('webinarShows')}
                >
                  <ReportDataTable
                    columns={[
                      { key: 'sessionYmd', label: 'Session' },
                      { key: 'scheduledOnYmd', label: 'Booked on' },
                      { key: 'candidateName', label: 'Candidate' },
                      { key: 'email', label: 'Email' },
                      { key: 'watchMinutes', label: 'Minutes' },
                      { key: 'customField', label: 'File tag' },
                    ]}
                    rows={report.webinarShows.map((r) => ({
                      id: r.id,
                      sessionYmd: r.sessionYmd,
                      scheduledOnYmd: r.scheduledOnYmd,
                      candidateName: r.candidateName,
                      email: r.email,
                      watchMinutes: String(r.watchMinutes),
                      customField: r.customField,
                    }))}
                  />
                </ReportExpandableSection>

                <ReportExpandableSection
                  title="Live sessions"
                  subtitle="Live-session bookings matched to Zoom attendance"
                  count={report.liveSessions.length}
                  open={openSections.has('live')}
                  onToggle={() => toggleSection('live')}
                >
                  <ReportDataTable
                    columns={[
                      { key: 'disposedAt', label: 'Booked at' },
                      { key: 'candidateEmail', label: 'Candidate email' },
                      { key: 'sessionDate', label: 'Session date' },
                      { key: 'attended', label: 'Attended' },
                    ]}
                    rows={report.liveSessions.map((r) => ({
                      id: r.callRecordId,
                      disposedAt: formatIso(r.disposedAt),
                      candidateEmail: r.candidateEmail,
                      sessionDate: r.sessionDate,
                      attended: r.attended ? 'Yes' : 'No',
                    }))}
                  />
                </ReportExpandableSection>

                <ReportExpandableSection
                  title="Emails"
                  subtitle="Sent from pipeline + inbound replies"
                  count={report.emails.length}
                  open={openSections.has('emails')}
                  onToggle={() => toggleSection('emails')}
                >
                  <ReportDataTable
                    columns={[
                      { key: 'at', label: 'When' },
                      { key: 'direction', label: 'Direction' },
                      { key: 'subject', label: 'Subject' },
                      { key: 'toOrFrom', label: 'To / From' },
                      { key: 'status', label: 'Status' },
                    ]}
                    rows={report.emails.map((r) => ({
                      id: r.id,
                      at: formatIso(r.at),
                      direction: r.direction,
                      subject: r.subject,
                      toOrFrom: r.toOrFrom,
                      status: r.status,
                    }))}
                  />
                </ReportExpandableSection>
              </div>
            </>
          )}
        </div>
  );
};

export default ReportDetail;
