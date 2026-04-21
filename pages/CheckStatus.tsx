import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button, Input } from '../components/UI';
import { getCandidateByEmail } from '../services/storageService';
import { formatDateCanadaEastern } from '../services/dateDisplay';
import { Candidate, PipelineStage, normalizePipelineStage } from '../types';
import { CheckCircle, XCircle, Calendar, FileText, Mail, Video, ClipboardList } from 'lucide-react';

const CheckStatus: React.FC = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [candidate, setCandidate] = useState<Candidate | null>(null);

  const getStatusInfo = (stage: PipelineStage | string | undefined) => {
    const s = normalizePipelineStage(stage);
    const statusMap: Record<PipelineStage, { label: string; color: string; bgColor: string; icon: React.ReactNode; message: string }> = {
      'Check in': {
        label: 'Check in',
        color: 'text-blue-700',
        bgColor: 'bg-blue-50 border-blue-200',
        icon: <FileText className="w-6 h-6 text-blue-600" />,
        message:
          'Thank you for checking in. We have received your information and will follow up with next steps.',
      },
      'Attended Live Session': {
        label: 'Attended Live Session',
        color: 'text-sky-700',
        bgColor: 'bg-sky-50 border-sky-200',
        icon: <Video className="w-6 h-6 text-sky-600" />,
        message:
          'Thank you for attending the Live Online Career Session. We appreciate your time and interest.',
      },
      'Leadership Assessment Received Under Review': {
        label: 'Leadership Assessment — Under Review',
        color: 'text-amber-700',
        bgColor: 'bg-amber-50 border-amber-200',
        icon: <ClipboardList className="w-6 h-6 text-amber-600" />,
        message:
          'We have received your Leadership Assessment. Our team is reviewing your responses and will contact you when there is an update.',
      },
      'Interview scheduled': {
        label: 'Interview scheduled',
        color: 'text-purple-700',
        bgColor: 'bg-purple-50 border-purple-200',
        icon: <Calendar className="w-6 h-6 text-purple-600" />,
        message:
          'An interview has been scheduled. Please check your email for date, time, and preparation details.',
      },
      Hired: {
        label: 'Hired',
        color: 'text-green-700',
        bgColor: 'bg-green-50 border-green-200',
        icon: <CheckCircle className="w-6 h-6 text-green-600" />,
        message:
          'Congratulations! You have been hired. Welcome to the team — please check your email for onboarding information.',
      },
      'Not Hired / Withdrawn': {
        label: 'Not Hired / Withdrawn',
        color: 'text-gray-700',
        bgColor: 'bg-gray-50 border-gray-200',
        icon: <XCircle className="w-6 h-6 text-gray-600" />,
        message:
          'This application is closed. Thank you for your interest in the opportunity. If you have questions, reply to our team by email.',
      },
    };
    return statusMap[s];
  };

  const handleCheckStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    const emailValue = email.trim().toLowerCase();
    
    if (!emailValue) {
      setError('Please enter your email address.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
      setError('Please enter a valid email address.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const found = await getCandidateByEmail(emailValue);
      
      if (!found) {
        setError('No application found with this email address. Please verify your email or contact our team if you believe this is an error.');
        setCandidate(null);
        return;
      }

      setCandidate(found);
    } catch (err) {
      console.error(err);
      setError('There was an issue checking your status. Please try again or contact our team.');
      setCandidate(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="flex-grow flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-2xl space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-[#005EB8]">Application Status Check</h1>
            <p className="text-gray-600">Enter your email address to view your current application status</p>
          </div>

          <form onSubmit={handleCheckStatus} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
            <Input
              label="Email Address"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error && !candidate ? error : undefined}
              required
            />
            <Button type="submit" fullWidth disabled={loading}>
              {loading ? 'Checking Status...' : 'Check Status'}
            </Button>
          </form>

          {candidate && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  {getStatusInfo(candidate.adminData?.pipelineStage).icon}
                </div>
                <div className="flex-grow">
                  <h2 className="text-xl font-bold text-gray-900 mb-1">
                    {candidate.firstName} {candidate.lastName}
                  </h2>
                  <p className="text-sm text-gray-500">{candidate.email}</p>
                </div>
              </div>

              {candidate.adminData?.questionnaireDisqualified && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <div className="flex items-start gap-3">
                    <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-red-800 mb-1">Application Not Eligible</p>
                      <p className="text-sm text-red-700">{candidate.adminData.questionnaireDisqualified.reason}</p>
                    </div>
                  </div>
                </div>
              )}

              {!candidate.adminData?.questionnaireDisqualified && (
                <>
                  <div className={`rounded-lg border p-4 ${getStatusInfo(candidate.adminData?.pipelineStage).bgColor}`}>
                    <div className="flex items-center gap-3 mb-2">
                      {getStatusInfo(candidate.adminData?.pipelineStage).icon}
                      <h3 className={`text-lg font-bold ${getStatusInfo(candidate.adminData?.pipelineStage).color}`}>
                        {getStatusInfo(candidate.adminData?.pipelineStage).label}
                      </h3>
                    </div>
                    <p className="text-gray-700 text-sm">
                      {getStatusInfo(candidate.adminData?.pipelineStage).message}
                    </p>
                  </div>

                  {candidate.adminData?.interviewScheduledAt && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                      <div className="flex items-start gap-3">
                        <Calendar className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-blue-800 mb-1">Interview Scheduled</p>
                          <p className="text-sm text-blue-700">
                            {formatDateCanadaEastern(candidate.adminData.interviewScheduledAt, {
                              weekday: 'long',
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                            })}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {candidate.adminData?.nextStep && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <div className="flex items-start gap-3">
                        <Mail className="w-5 h-5 text-gray-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-gray-800 mb-1">Next Steps</p>
                          <p className="text-sm text-gray-700 whitespace-pre-line">{candidate.adminData.nextStep}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="pt-4 border-t border-gray-200">
                    <p className="text-xs text-gray-500">
                      Application submitted: {formatDateCanadaEastern(candidate.timestamp, {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                    {candidate.adminData?.resumeReviewedAt && (
                      <p className="text-xs text-gray-500 mt-1">
                        Resume reviewed: {formatDateCanadaEastern(candidate.adminData.resumeReviewedAt, {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {error && !candidate && (
            <div className="bg-white rounded-xl shadow-sm border border-red-200 p-4">
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          <div className="text-center">
            <Button variant="outline" onClick={() => navigate('/')}>
              Return to Home
            </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default CheckStatus;
