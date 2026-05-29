import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing';
import InterviewForm from './pages/InterviewForm';
import PostInterview from './pages/PostInterview';
import AssessmentIntro from './pages/AssessmentIntro';
import Assessment from './pages/Assessment';
import ThankYou from './pages/ThankYou';
import NotEligible from './pages/NotEligible';
import AdminDashboard from './pages/AdminDashboard';
import QrCodes from './pages/QrCodes';
import AssessmentLookup from './pages/AssessmentLookup';
import AssessmentRoomForm from './pages/AssessmentRoomForm';
import CheckStatus from './pages/CheckStatus';
import LiveSessionsDashboard from './pages/LiveSessionsDashboard';
import WebinarGeekDashboard from './pages/WebinarGeekDashboard';
import CallsAnalytics from './pages/CallsAnalytics';
import HRDashboard from './pages/HRDashboard';
import EmailLog from './pages/EmailLog';
import Pipeline from './pages/Pipeline';
import PipelineCallWorkspace from './pages/PipelineCallWorkspace';
import PipelinePerformance from './pages/PipelinePerformance';
import PipelineEmailWorkspace from './pages/PipelineEmailWorkspace';
import PipelineUploadsWorkspace from './pages/PipelineUploadsWorkspace';
import PipelineSettings from './pages/PipelineSettings';
import SuperDashboard from './pages/SuperDashboard';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/checkin" element={<InterviewForm />} />
        <Route path="/interview" element={<Navigate to="/checkin" replace />} />
        <Route path="/check-status" element={<CheckStatus />} />
        <Route path="/confirmation/:id" element={<PostInterview />} />
        <Route path="/assessment-intro/:id" element={<AssessmentIntro />} />
        <Route path="/assessment/:id" element={<Assessment />} />
        <Route path="/assessment-room/:id" element={<AssessmentRoomForm />} />
        <Route path="/assessment-lookup" element={<AssessmentLookup />} />
        <Route path="/thank-you" element={<ThankYou />} />
        <Route path="/not-eligible" element={<NotEligible />} />
        <Route path="/dashboard" element={<AdminDashboard />} />
        <Route path="/admin" element={<Navigate to="/dashboard" replace />} />
        <Route path="/live-sessions" element={<LiveSessionsDashboard />} />
        <Route path="/webinar-geek" element={<WebinarGeekDashboard />} />
        <Route path="/calls-analytics" element={<CallsAnalytics />} />
        <Route path="/hr-dashboard" element={<HRDashboard />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/pipeline/call" element={<PipelineCallWorkspace />} />
        <Route path="/pipeline/performance" element={<PipelinePerformance />} />
        <Route path="/pipeline/email" element={<PipelineEmailWorkspace />} />
        <Route path="/pipeline/uploads" element={<PipelineUploadsWorkspace />} />
        <Route path="/pipeline-settings" element={<PipelineSettings />} />
        <Route path="/superdashboard" element={<SuperDashboard />} />
        <Route path="/qr" element={<QrCodes />} />
        <Route path="/email-log" element={<EmailLog />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;