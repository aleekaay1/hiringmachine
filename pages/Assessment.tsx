import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button, Input, Select, Card } from '../components/UI';
import { getCandidateById, saveCandidate, calculateScore } from '../services/storageService';
import { Candidate, AssessmentData, QUESTIONS } from '../types';

const Assessment: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [alreadyCompleted, setAlreadyCompleted] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  // Form State
  const [step, setStep] = useState<'intro' | 'background' | 'questions'>('intro');
  const [background, setBackground] = useState({
    occupation: '',
    currentRole: '',
    areas: [] as string[],
    salesExperience: ''
  });

  // Question State
  const [competitiveness, setCompetitiveness] = useState<number>(5);
  const [moneyMotivation, setMoneyMotivation] = useState<number>(5);
  const [likertResponses, setLikertResponses] = useState<Record<number, number>>({});
  const [trueScaleResponses, setTrueScaleResponses] = useState<Record<number, number>>({});

  const backgroundAreaList = ['Sales', 'Customer Service', 'Management / Leadership', 'Entrepreneurial / Business Owner', 'Corporate / Professional', 'Trades / Skilled Labour', 'Administrative / Office Support', 'Technical / Digital Skills', 'Social Media / Marketing', 'Other'];

  useEffect(() => {
    if (!id) {
      setLoading(false);
      navigate('/');
      return;
    }
    const fetchCandidate = async () => {
      try {
        const c = await getCandidateById(id);
        if (!c) {
          navigate('/');
          return;
        }
        if (c.status === 'assessment_complete' || c.assessment) {
          setCandidate(c);
          setAlreadyCompleted(true);
        } else {
          setCandidate(c);
          const aq = c.applicantQuestionnaire;
          if (aq) {
            setBackground(prev => ({
              ...prev,
              occupation: aq.occupation || prev.occupation,
              currentRole: aq.currentRole || prev.currentRole,
              areas: Array.isArray(aq.backgroundAreas) ? aq.backgroundAreas.filter((a: string) => backgroundAreaList.includes(a)) : prev.areas,
              salesExperience: aq.salesExperience || prev.salesExperience,
            }));
          }
        }
      } catch (err) {
        console.error(err);
        navigate('/');
      } finally {
        setLoading(false);
      }
    };
    fetchCandidate();
  }, [id, navigate]);

  const scrollToTop = () => {
    topRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleAreaToggle = (area: string) => {
    setBackground(prev => {
      const areas = prev.areas.includes(area)
        ? prev.areas.filter(a => a !== area)
        : [...prev.areas, area];
      return { ...prev, areas };
    });
  };

  const handleSubmit = async () => {
    if (!candidate || submitting) return;

    const assessmentData: AssessmentData = {
      occupation: background.occupation,
      currentRole: background.currentRole,
      backgroundAreas: background.areas,
      salesExperience: background.salesExperience,
      competitiveness,
      moneyMotivation,
      likertResponses,
      trueScaleResponses
    };

    const { score, fitCategory } = calculateScore(assessmentData);

    const updatedCandidate: Candidate = {
      ...candidate,
      status: 'assessment_complete',
      assessment: assessmentData,
      score,
      fitCategory
    };

    try {
      setSubmitting(true);
      await saveCandidate(updatedCandidate);
      navigate('/thank-you');
    } catch (err) {
      console.error(err);
      alert('There was an issue submitting your assessment. Please try again.');
      setSubmitting(false);
    }
  };

  // --- RENDER STEPS ---

  if (loading) {
    return (
      <Layout>
        <div className="flex-grow flex items-center justify-center">
          <p className="text-gray-500">Loading assessment...</p>
        </div>
      </Layout>
    );
  }

  if (alreadyCompleted && candidate) {
    return (
      <Layout>
        <div className="flex-grow flex flex-col items-center justify-center p-6">
          <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center space-y-4">
            <h2 className="text-xl font-bold text-gray-900">You&apos;ve already completed the assessment</h2>
            <p className="text-gray-600">Thank you. Our Leadership Team will review your responses and contact you regarding next steps.</p>
            <Button fullWidth onClick={() => navigate('/thank-you')}>Go to thank you page</Button>
          </div>
        </div>
      </Layout>
    );
  }

  if (step === 'intro') {
    return (
      <Layout>
        <div className="p-6 max-w-2xl mx-auto space-y-6">
          <div className="bg-white p-8 rounded-xl shadow-sm border-l-4 border-[#005EB8]">
            <h2 className="text-xl font-bold text-[#005EB8] mb-4">Globe Life AIL Division – Leadership & Career Assessment</h2>
            <div className="space-y-4 text-gray-700 leading-relaxed">
              <p>Thank you for your interest in exploring a career opportunity with Globe Life AIL Division.</p>
              <p>This assessment is designed to help our Leadership Team better understand your:</p>
              <ul className="list-disc pl-5 space-y-1 font-medium text-gray-800">
                <li>Professional background</li>
                <li>Competitive drive</li>
                <li>Leadership potential</li>
                <li>Entrepreneurial mindset</li>
              </ul>
              <p>There are no “right” or “wrong” answers — we are simply looking for alignment between your goals and the demands of a high-performance environment.</p>
              <p>Please answer each question honestly and thoughtfully.</p>
            </div>
            <div className="mt-8">
              <Button onClick={() => setStep('background')} fullWidth>Continue to Background</Button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  if (step === 'background') {
    return (
      <Layout>
        <div ref={topRef} className="p-6 max-w-lg mx-auto w-full pb-24">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Section A — Background</h2>
          <div className="space-y-8">
            <Select
              label="1. What is your current occupation and employment status?"
              value={background.occupation}
              onChange={(e) => setBackground({...background, occupation: e.target.value})}
              options={[
                { value: 'full-time', label: 'Employed full-time' },
                { value: 'part-time', label: 'Employed part-time' },
                { value: 'self-employed', label: 'Self-employed' },
                { value: 'student', label: 'Student' },
                { value: 'unemployed', label: 'Not currently employed' },
              ]}
              required
            />

            <Input
              label="2. Current Role / Company (if applicable)"
              value={background.currentRole}
              onChange={(e) => setBackground({...background, currentRole: e.target.value})}
            />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                3. Which areas best describe your background? (Select all that apply) <span className="text-red-500">*</span>
              </label>
              <div className="space-y-2">
                {backgroundAreaList.map(area => (
                  <div 
                    key={area}
                    onClick={() => handleAreaToggle(area)}
                    className={`p-3 rounded-lg border cursor-pointer flex items-center transition-colors ${
                      background.areas.includes(area) ? 'bg-blue-50 border-[#005EB8] text-[#005EB8]' : 'bg-white border-gray-200'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded border mr-3 flex items-center justify-center ${
                      background.areas.includes(area) ? 'bg-[#005EB8] border-[#005EB8]' : 'border-gray-300'
                    }`}>
                      {background.areas.includes(area) && <span className="text-white text-xs">✓</span>}
                    </div>
                    {area}
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                4. Briefly describe any experience you have in sales, leadership, or generating revenue. <span className="text-red-500">*</span>
              </label>
              <textarea 
                className="w-full p-3 rounded-lg border border-gray-300 focus:ring-[#005EB8] focus:ring-2 focus:outline-none min-h-[120px]"
                value={background.salesExperience}
                onChange={(e) => setBackground({...background, salesExperience: e.target.value})}
                required
              />
            </div>
          </div>

          <div className="fixed bottom-0 left-0 right-0 p-6 bg-white border-t border-gray-100 z-10">
            <div className="max-w-lg mx-auto">
              <Button 
                fullWidth 
                onClick={() => {
                  if (background.occupation && background.areas.length > 0 && background.salesExperience) {
                    setStep('questions');
                    scrollToTop();
                  } else {
                    alert('Please complete all required fields.');
                  }
                }}
              >
                Next Section
              </Button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // --- QUESTION SECTION RENDER HELPERS ---

  const renderScale1to10 = (label: string, value: number, onChange: (v: number) => void) => (
    <div className="bg-white p-6 rounded-xl border border-gray-200 space-y-4">
      <label className="font-semibold text-gray-900 block">{label}</label>
      <div className="flex justify-between items-center text-xs font-medium text-gray-400 uppercase tracking-wide">
        <span>Low</span>
        <span>High</span>
      </div>
      <div className="flex justify-between gap-1">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(num => (
          <button
            key={num}
            onClick={() => onChange(num)}
            className={`w-8 h-10 rounded flex items-center justify-center font-bold text-sm transition-all ${
              value === num ? 'bg-[#005EB8] text-white shadow-lg scale-110' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {num}
          </button>
        ))}
      </div>
    </div>
  );

  const renderLikert = (id: number, text: string) => {
    const val = likertResponses[id];
    return (
      <div className="bg-white p-6 rounded-xl border border-gray-200 space-y-3" key={id}>
        <p className="font-medium text-gray-800">{text}</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Strongly Agree', score: 3 },
            { label: 'Agree', score: 2 },
            { label: 'Disagree', score: 1 },
            { label: 'Strongly Disagree', score: 0 }
          ].map(opt => (
            <button
              key={opt.label}
              onClick={() => setLikertResponses(prev => ({ ...prev, [id]: opt.score }))}
              className={`py-2 px-3 text-sm rounded-lg border transition-all ${
                val === opt.score 
                  ? 'bg-[#005EB8] text-white border-[#005EB8]' 
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderTrueScale = (id: number, text: string) => {
    const val = trueScaleResponses[id];
    return (
      <div className="bg-white p-6 rounded-xl border border-gray-200 space-y-3" key={id}>
        <p className="font-medium text-gray-800">{text}</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'Always True', score: 3 },
            { label: 'Quite True', score: 2 },
            { label: 'Rarely True', score: 1 },
            { label: 'Never True', score: 0 }
          ].map(opt => (
            <button
              key={opt.label}
              onClick={() => setTrueScaleResponses(prev => ({ ...prev, [id]: opt.score }))}
              className={`py-2 px-3 text-sm rounded-lg border transition-all ${
                val === opt.score 
                  ? 'bg-[#005EB8] text-white border-[#005EB8]' 
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  // Check if all questions answered
  const totalQuestions = 2 + QUESTIONS.likert.length + QUESTIONS.trueScale.length;
  const answeredCount = 2 + Object.keys(likertResponses).length + Object.keys(trueScaleResponses).length;
  const isComplete = totalQuestions === answeredCount;

  return (
    <Layout>
      <div ref={topRef} className="p-6 max-w-lg mx-auto w-full pb-32 space-y-8">
        <div>
           <h2 className="text-2xl font-bold text-gray-900 mb-2">Section B — Leadership & EQ</h2>
           <p className="text-gray-500 text-sm">Please answer honestly.</p>
        </div>

        {/* 1-10 Scales */}
        <div className="space-y-4">
          {renderScale1to10("On a scale of 1–10, how competitive are you?", competitiveness, setCompetitiveness)}
          {renderScale1to10("On a scale of 1–10, how motivated are you by income growth?", moneyMotivation, setMoneyMotivation)}
        </div>

        {/* Likert */}
        <div className="space-y-4">
          {QUESTIONS.likert.map(q => renderLikert(q.id, q.text))}
        </div>

        {/* True Scale */}
        <div className="space-y-4">
          {QUESTIONS.trueScale.map(q => renderTrueScale(q.id, q.text))}
        </div>

        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-gray-100 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          <div className="max-w-lg mx-auto flex items-center justify-between gap-4">
            <div className="text-xs text-gray-500 font-medium">
              Progress: {Math.round((answeredCount / totalQuestions) * 100)}%
            </div>
            <div className="flex-grow">
              <Button 
                fullWidth 
                disabled={!isComplete || submitting} 
                onClick={handleSubmit}
              >
                {submitting ? 'Submitting...' : 'Submit Assessment'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Assessment;