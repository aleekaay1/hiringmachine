import React from 'react';
import { useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import { CheckCircle } from 'lucide-react';

const ThankYou: React.FC = () => {
  const location = useLocation();
  const state = (location.state as {
    fromMergedAssessment?: boolean;
    fromCheckin?: boolean;
    notEligibleCanada?: boolean;
  } | null) || null;

  return (
    <Layout compactHeader>
      <div className="flex flex-grow flex-col items-center justify-center p-6 text-center animate-fade-in">
        <div className="mb-6 flex h-24 w-24 animate-bounce-slow items-center justify-center rounded-full bg-green-50 text-[#37B06D]">
          <CheckCircle size={48} />
        </div>

        <h2 className="mb-2 text-3xl font-bold text-gray-900">Thank You</h2>
        <p className="mb-6 text-sm font-medium text-[#005EB8]">AO Paz Globelife</p>

        <div className="max-w-md space-y-4 text-gray-600">
          {state?.fromCheckin && state?.notEligibleCanada ? (
            <>
              <p className="text-lg text-gray-900">We received your check-in.</p>
              <p>
                This role requires that you are legally entitled to work in Canada. Because you indicated you are not, we are not able to move you forward in this process.
              </p>
              <p className="mt-8 text-sm text-gray-400">Thank you for your interest and your time.</p>
            </>
          ) : state?.fromCheckin ? (
            <>
              <p className="text-lg">Your check-in was received.</p>
              <p>
                You will receive an email with the webinar details if you are shortlisted.
              </p>
              <p className="mt-8 text-sm text-gray-400">Thank you for your time.</p>
            </>
          ) : state?.fromMergedAssessment ? (
            <>
              <p className="text-lg">Thank you for your submission.</p>
              <p>
                Your application will be reviewed by our management team, and you will be contacted if you are selected.
              </p>
              <p className="mt-8 text-sm text-gray-400">Thank you for your time and professionalism.</p>
            </>
          ) : (
            <>
              <p className="text-lg">Your information has been submitted.</p>
              <div className="mx-auto my-6 h-px w-1/2 bg-gray-200" />
              <p>If you have just checked in, please wait for further instructions from our team.</p>
              <p className="mt-8 text-sm text-gray-400">Thank you for your time and professionalism.</p>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default ThankYou;
