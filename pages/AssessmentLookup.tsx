import React, { useState } from 'react';
import Layout from '../components/Layout';
import { Button, Input } from '../components/UI';
import { resolveAssessmentLookup } from '../services/assessmentLookupService';
import { useNavigate } from 'react-router-dom';

const AssessmentLookup: React.FC = () => {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [alreadyCompleted, setAlreadyCompleted] = useState(false);
  const [lookupHint, setLookupHint] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = phone.trim();
    if (!normalizedEmail && !normalizedPhone.replace(/\D/g, '')) {
      alert('Please enter the email or phone you used for the live session (or at check-in).');
      return;
    }

    try {
      setLoading(true);
      setLookupHint(null);
      const result = await resolveAssessmentLookup({
        email: normalizedEmail || undefined,
        phone: normalizedPhone || undefined,
      });

      if (!result.ok) {
        alert(result.message || result.error);
        setLoading(false);
        return;
      }

      if (result.source.startsWith('live_session')) {
        setLookupHint('Found on the live session list — your assessment profile is ready.');
      }

      if (result.alreadyCompleted) {
        setAlreadyCompleted(true);
        setLoading(false);
        return;
      }

      navigate(`/assessment-room/${result.candidateId}`);
    } catch (err) {
      console.error(err);
      alert('There was an issue looking up your record. Please try again or speak with the management team.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="flex-grow flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold text-gray-900">
              Leadership & Career Assessment
            </h2>
            <p className="text-sm text-gray-500">
              Enter the email or phone you used on Calendly, Zoom, or at check-in. If you attended a live
              session but have not checked in yet, we will find you on the session list.
            </p>
          </div>

          {alreadyCompleted ? (
            <div className="rounded-lg border border-[#005EB8]/30 bg-blue-50/80 p-6 text-center space-y-4">
              <p className="font-semibold text-gray-900">You&apos;ve already completed the assessment.</p>
              <p className="text-sm text-gray-600">Thank you. Our Leadership Team will review your responses and contact you regarding next steps.</p>
              <Button type="button" fullWidth onClick={() => navigate('/thank-you')}>
                View thank you page
              </Button>
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {lookupHint && (
              <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">
                {lookupHint}
              </p>
            )}
            <Input
              label="Email Address (preferred)"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="Phone Number"
              type="tel"
              placeholder="(555) 123-4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <p className="text-[11px] text-gray-400">
              Use the same email you registered with on Calendly if possible. Phone alone works when it
              matches our live session records.
            </p>

            <Button type="submit" fullWidth disabled={loading}>
              {loading ? 'Finding your profile...' : 'Continue to Assessment'}
            </Button>
          </form>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default AssessmentLookup;
