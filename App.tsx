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

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/interview" element={<InterviewForm />} />
        <Route path="/check-status" element={<CheckStatus />} />
        <Route path="/confirmation/:id" element={<PostInterview />} />
        <Route path="/assessment-intro/:id" element={<AssessmentIntro />} />
        <Route path="/assessment/:id" element={<Assessment />} />
        <Route path="/assessment-room/:id" element={<AssessmentRoomForm />} />
        <Route path="/assessment-lookup" element={<AssessmentLookup />} />
        <Route path="/thank-you" element={<ThankYou />} />
        <Route path="/not-eligible" element={<NotEligible />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/qr" element={<QrCodes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;