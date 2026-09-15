import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AdminShell from './components/AdminShell';
import AdminRouteFallback from './components/AdminRouteFallback';
import Landing from './pages/Landing';
import InterviewForm from './pages/InterviewForm';
import ScheduleWebinarPage from './pages/ScheduleWebinarPage';
import PostInterview from './pages/PostInterview';
import AssessmentIntro from './pages/AssessmentIntro';
import Assessment from './pages/Assessment';
import ThankYou from './pages/ThankYou';
import NotEligible from './pages/NotEligible';
import AssessmentLookup from './pages/AssessmentLookup';
import AssessmentRoomForm from './pages/AssessmentRoomForm';
import CheckStatus from './pages/CheckStatus';

const RoleHome = React.lazy(() => import('./pages/RoleHome'));
const AdminDashboard = React.lazy(() => import('./pages/AdminDashboard'));
const QrCodes = React.lazy(() => import('./pages/QrCodes'));
const LiveSessionsDashboard = React.lazy(() => import('./pages/LiveSessionsDashboard'));
const LiveSessionsAnalyticsPage = React.lazy(() => import('./pages/LiveSessionsAnalyticsPage'));
const WebinarGeekDashboard = React.lazy(() => import('./pages/WebinarGeekDashboard'));
const WebinarQuestionnairesPage = React.lazy(() => import('./pages/WebinarQuestionnairesPage'));
const LeadershipLeaderboard = React.lazy(() => import('./pages/LeadershipLeaderboard'));
const HRDashboard = React.lazy(() => import('./pages/HRDashboard'));
const EmailLog = React.lazy(() => import('./pages/EmailLog'));
const CallLog = React.lazy(() => import('./pages/CallLog'));
const Pipeline = React.lazy(() => import('./pages/Pipeline'));
const HmCallWorkspace = React.lazy(() => import('./pages/HmCallWorkspace'));
const SentAheadPage = React.lazy(() => import('./pages/SentAheadPage'));
const CheckInsPage = React.lazy(() => import('./pages/CheckInsPage'));
const InstantlyRepliesPage = React.lazy(() => import('./pages/InstantlyRepliesPage'));
const BulkEmailPage = React.lazy(() => import('./pages/BulkEmailPage'));
const ScheduleWebinarSignupsPage = React.lazy(() => import('./pages/ScheduleWebinarSignupsPage'));
const PipelinePerformance = React.lazy(() => import('./pages/PipelinePerformance'));
const PipelineEmailWorkspace = React.lazy(() => import('./pages/PipelineEmailWorkspace'));
const PipelineUploadsWorkspace = React.lazy(() => import('./pages/PipelineUploadsWorkspace'));
const LeadManagerLayout = React.lazy(() => import('./pages/LeadManagerLayout'));
const LeadManagerLeadsPage = React.lazy(() => import('./pages/LeadManagerLeadsPage'));
const LeadManagerPacksPage = React.lazy(() => import('./pages/LeadManagerPacksPage'));
const WebinarVerifyPage = React.lazy(() => import('./pages/WebinarVerifyPage'));
const Reports = React.lazy(() => import('./pages/Reports'));
const ReportDetail = React.lazy(() => import('./pages/ReportDetail'));
const SupportPage = React.lazy(() => import('./pages/SupportPage'));
const PerformanceCheckInPage = React.lazy(() => import('./pages/PerformanceCheckInPage'));
const PerformanceCheckInsAdminPage = React.lazy(() => import('./pages/PerformanceCheckInsAdminPage'));
const OpsConsolePage = React.lazy(() => import('./pages/OpsConsolePage'));
const HrLeadDistributionPage = React.lazy(() => import('./pages/HrLeadDistributionPage'));
const HrAllLeadsPage = React.lazy(() => import('./pages/HrAllLeadsPage'));
const AccountSettingsPage = React.lazy(() => import('./pages/AccountSettingsPage'));
const StaffDirectoryPage = React.lazy(() => import('./pages/StaffDirectoryPage'));

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<AdminRouteFallback />}>{children}</Suspense>;
}

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/checkin" element={<InterviewForm />} />
        <Route path="/schedule-webinar" element={<ScheduleWebinarPage />} />
        <Route path="/webinar" element={<Navigate to="/schedule-webinar" replace />} />
        <Route path="/interview" element={<Navigate to="/checkin" replace />} />
        <Route path="/check-status" element={<CheckStatus />} />
        <Route path="/confirmation/:id" element={<PostInterview />} />
        <Route path="/assessment-intro/:id" element={<AssessmentIntro />} />
        <Route path="/assessment/:id" element={<Assessment />} />
        <Route path="/assessment-room/:id" element={<AssessmentRoomForm />} />
        <Route path="/assessment-lookup" element={<AssessmentLookup />} />
        <Route path="/thank-you" element={<ThankYou />} />
        <Route path="/not-eligible" element={<NotEligible />} />

        <Route element={<AdminShell />}>
          <Route path="/home" element={<Lazy><RoleHome /></Lazy>} />
          <Route path="/check-ins" element={<Lazy><CheckInsPage /></Lazy>} />
          <Route path="/replies" element={<Lazy><InstantlyRepliesPage /></Lazy>} />
          <Route path="/bulk-email" element={<Lazy><BulkEmailPage /></Lazy>} />
          <Route path="/schedule-webinar-signups" element={<Lazy><ScheduleWebinarSignupsPage /></Lazy>} />
          <Route path="/sent-ahead" element={<Lazy><SentAheadPage /></Lazy>} />
          <Route path="/dashboard" element={<Lazy><AdminDashboard /></Lazy>} />
          <Route path="/admin" element={<Navigate to="/home" replace />} />
          <Route path="/live-sessions" element={<Lazy><LiveSessionsDashboard /></Lazy>} />
          <Route path="/live-sessions/analytics" element={<Lazy><LiveSessionsAnalyticsPage /></Lazy>} />
          <Route path="/webinar-geek" element={<Lazy><WebinarGeekDashboard /></Lazy>} />
          <Route path="/webinar-questionnaires" element={<Lazy><WebinarQuestionnairesPage /></Lazy>} />
          <Route path="/calls-analytics" element={<Navigate to="/reports" replace />} />
          <Route path="/calls-analytics/leaderboard" element={<Lazy><LeadershipLeaderboard /></Lazy>} />
          <Route path="/leaderboard" element={<Navigate to="/calls-analytics/leaderboard" replace />} />
          <Route path="/hr-dashboard" element={<Lazy><HRDashboard /></Lazy>} />
          <Route path="/hr/lead-distribution" element={<Lazy><HrLeadDistributionPage /></Lazy>} />
          <Route path="/hr/leads" element={<Lazy><HrAllLeadsPage /></Lazy>} />
          <Route path="/account" element={<Lazy><AccountSettingsPage /></Lazy>} />
          <Route path="/pipeline" element={<Lazy><Pipeline /></Lazy>} />
          <Route path="/pipeline/lead-manager" element={<Lazy><LeadManagerLayout /></Lazy>}>
            <Route index element={<Lazy><LeadManagerPacksPage /></Lazy>} />
            <Route path="leads" element={<Lazy><LeadManagerLeadsPage /></Lazy>} />
          </Route>
          <Route path="/pipeline/call" element={<Lazy><HmCallWorkspace /></Lazy>} />
          <Route path="/pipeline/performance" element={<Lazy><PipelinePerformance /></Lazy>} />
          <Route path="/pipeline/email" element={<Lazy><PipelineEmailWorkspace /></Lazy>} />
          <Route path="/pipeline/webinar-verify" element={<Lazy><WebinarVerifyPage /></Lazy>} />
          <Route path="/pipeline/uploads" element={<Lazy><PipelineUploadsWorkspace /></Lazy>} />
          <Route path="/pipeline-settings" element={<Navigate to="/account#recruiter-call-settings" replace />} />
          <Route path="/superdashboard" element={<Navigate to="/home" replace />} />
          <Route path="/qr" element={<Lazy><QrCodes /></Lazy>} />
          <Route path="/email-log" element={<Lazy><EmailLog /></Lazy>} />
          <Route path="/call-log" element={<Lazy><CallLog /></Lazy>} />
          <Route path="/reports" element={<Lazy><Reports /></Lazy>} />
          <Route path="/reports/:userId" element={<Lazy><ReportDetail /></Lazy>} />
          <Route path="/admin/staff" element={<Lazy><StaffDirectoryPage /></Lazy>} />
          <Route path="/support" element={<Lazy><SupportPage /></Lazy>} />
          <Route path="/performance-check-in" element={<Lazy><PerformanceCheckInPage /></Lazy>} />
          <Route path="/performance-check-ins" element={<Lazy><PerformanceCheckInsAdminPage /></Lazy>} />
          <Route path="/ops-console" element={<Lazy><OpsConsolePage /></Lazy>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
