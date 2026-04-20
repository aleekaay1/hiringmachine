import React, { useState } from 'react';
import Layout from '../components/Layout';
import { Button, Input } from '../components/UI';
import { getCandidateByEmail } from '../services/storageService';
import { useNavigate } from 'react-router-dom';

const AssessmentLookup: React.FC = () => {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [alreadyCompleted, setAlreadyCompleted] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      alert('Please provide the email you used at check-in so we can find your record.');
      return;
    }

    try {
      setLoading(true);
      const normalizedEmail = email.trim().toLowerCase();
      const match = await getCandidateByEmail(normalizedEmail);

      if (!match) {
        alert('We could not find a matching record. Please confirm your details with the management team.');
        setLoading(false);
        return;
      }

      if (match.status === 'assessment_complete' || match.assessment) {
        setAlreadyCompleted(true);
        setLoading(false);
        return;
      }

      // Second QR: go to assessment room form (Basic Info + Professional Background + 30Q)
      navigate(`/assessment-room/${match.id}`);
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
              Please enter the same contact details you used at check-in so we
              can connect your assessment to your profile.
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
              You can provide either email, phone, or both. We’ll match your
              existing candidate record.
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

