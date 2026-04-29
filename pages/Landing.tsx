import React from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button } from '../components/UI';
import { ArrowRight } from 'lucide-react';

const Landing: React.FC = () => {
  const navigate = useNavigate();

  return (
    <Layout headerBannerSrc="/header.PNG">
      <div className="flex-grow flex flex-col items-stretch justify-center w-full max-w-6xl xl:max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-6 sm:py-10 text-center animate-fade-in safe-area-bottom">
        <div className="w-full space-y-6 sm:space-y-8 lg:space-y-10">
          <div className="space-y-4 sm:space-y-5">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#005EB8] tracking-tight">
              Welcome
            </h2>
            <p className="text-xl sm:text-2xl lg:text-3xl font-medium text-gray-700">Paz Organization</p>
            <div className="w-20 sm:w-24 h-1.5 bg-[#37B06D] mx-auto rounded-full"></div>
            <p className="text-base sm:text-lg text-gray-500 leading-relaxed max-w-3xl mx-auto px-1">
              Globe Life AIL Division<br />
              Please complete the form as directed by the Management Team.
            </p>
          </div>

          <div className="pt-2 sm:pt-4 space-y-4 max-w-2xl mx-auto w-full sm:max-w-3xl lg:max-w-4xl">
            <Button
              fullWidth
              onClick={() => navigate('/checkin')}
              className="text-base sm:text-lg py-4 min-h-[48px] shadow-xl touch-manipulation"
            >
              Start Applicant Questionnaire <ArrowRight className="ml-2 shrink-0" size={20} />
            </Button>
            <Button
              fullWidth
              variant="outline"
              onClick={() => navigate('/check-status')}
              className="text-base sm:text-lg py-4 min-h-[48px] touch-manipulation"
            >
              Check Application Status
            </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Landing;