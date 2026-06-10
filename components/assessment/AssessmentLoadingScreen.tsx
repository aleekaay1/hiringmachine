import React from 'react';
import { motion } from 'framer-motion';
import Layout from '../Layout';
import HomeLoadingScreen, { type HomeLoadingProgress } from '../dashboard/HomeLoadingScreen';

type Props = {
  label?: string;
};

const AssessmentLoadingScreen: React.FC<Props> = ({ label = 'Loading your assessment…' }) => {
  const [progress, setProgress] = React.useState<HomeLoadingProgress>({ pct: 8, label });

  React.useEffect(() => {
    setProgress({ pct: 8, label });
    const tick = window.setInterval(() => {
      setProgress((prev) => ({
        ...prev,
        pct: Math.min(prev.pct + 4, 92),
        label,
      }));
    }, 280);
    return () => window.clearInterval(tick);
  }, [label]);

  return (
    <Layout>
      <div className="flex-grow flex flex-col items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <HomeLoadingScreen progress={progress} title="Loading your assessment" compact />
        </motion.div>
      </div>
    </Layout>
  );
};

export default AssessmentLoadingScreen;
