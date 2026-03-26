import React from 'react';
import { useLocation } from 'react-router-dom';
import Layout from '../components/Layout';
import { CheckCircle } from 'lucide-react';

const ThankYou: React.FC = () => {
  const location = useLocation();
  const fromMergedAssessment = (location.state as { fromMergedAssessment?: boolean } | null)?.fromMergedAssessment;

  return (
    <Layout>
      <div className="flex-grow flex flex-col items-center justify-center p-6 text-center animate-fade-in">
        <div className="bg-green-50 w-24 h-24 rounded-full flex items-center justify-center mb-6 text-[#37B06D] animate-bounce-slow">
          <CheckCircle size={48} />
        </div>

        <h2 className="text-3xl font-bold text-gray-900 mb-6">Thank You</h2>

        <div className="max-w-md space-y-4 text-gray-600">
          {fromMergedAssessment ? (
            <>
              <p className="text-lg">Thank you for your submission.</p>
              <p>
                Your application will be reviewed by our management team, and you will be contacted if you are selected.
              </p>
              <p className="text-sm text-gray-400 mt-8">Thank you for your time and professionalism.</p>
            </>
          ) : (
            <>
              <p className="text-lg">Your information has been submitted.</p>
              <div className="h-px bg-gray-200 w-1/2 mx-auto my-6"></div>
              <p>If you have just checked in, please wait for further instructions from our team.</p>
              <p className="text-sm text-gray-400 mt-8">Thank you for your time and professionalism.</p>
            </>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default ThankYou;