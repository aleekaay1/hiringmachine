import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button, Input, Select } from '../components/UI';
import { getCandidateById, saveCandidate, calculateScore } from '../services/storageService';
import { Candidate, AssessmentData, QUESTIONS, ASSESSMENT_ROOM_BACKGROUND_AREAS } from '../types';

const AssessmentRoomForm: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [alreadyCompleted, setAlreadyCompleted] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  // Section 1: Basic info
  const [basic, setBasic] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    city: ''
  });

  // Section 2: Professional background
  const [background, setBackground] = useState({
    occupation: '',
    currentRole: '',
    areas: [] as string[],
    salesExperience: ''
  });

  // Assessment questions
  const [competitiveness, setCompetitiveness] = useState<number>(5);
  const [moneyMotivation, setMoneyMotivation] = useState<number>(5);
  const [openEndedAnswers, setOpenEndedAnswers] = useState<Record<number, string>>({});
  const [personalityAnswers, setPersonalityAnswers] = useState<Record<number, LikertOptionKey>>({});
  const [scenarioAnswers, setScenarioAnswers] = useState<Record<number, string>>({});
  const [eqAnswers, setEqAnswers] = useState<Record<number, LikertOptionKey>>({});

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
          setBasic({
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            phone: c.phone || '',
            city: c.city || ''
          });
          const aq = c.applicantQuestionnaire;
          if (aq) {
            setBackground(prev => ({
              ...prev,
              occupation: aq.occupation || prev.occupation,
              currentRole: aq.currentRole || prev.currentRole,
              areas: Array.isArray(aq.backgroundAreas) ? aq.backgroundAreas.filter((a: string) => ASSESSMENT_ROOM_BACKGROUND_AREAS.includes(a as any)) : prev.areas,
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

    const aq = candidate.applicantQuestionnaire;

    const assessmentData: AssessmentData = {
      occupation: aq?.occupation || '',
      currentRole: aq?.currentRole || '',
      backgroundAreas: aq?.backgroundAreas || [],
      salesExperience: aq?.salesExperience || '',
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
            type="button"
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

  const renderLikert = (qId: number, text: string) => {
    const val = likertResponses[qId];
    return (
      <div className="bg-white p-6 rounded-xl border border-gray-200 space-y-3" key={qId}>
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
              type="button"
              onClick={() => setLikertResponses(prev => ({ ...prev, [qId]: opt.score }))}
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

  const renderEq = (qId: number, text: string) => {
    const val = eqAnswers[qId];
    return (
      <div className="bg-white p-6 rounded-xl border border-gray-200 space-y-3" key={qId}>
        <p className="font-medium text-gray-800">{text}</p>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(EQ_LIKERT_OPTIONS).map(([key, opt]) => (
            <button
              key={key}
              type="button"
              onClick={() => setEqAnswers(prev => ({ ...prev, [qId]: key as LikertOptionKey }))}
              className={`py-2 px-3 text-sm rounded-lg border transition-all ${
                val === (key as LikertOptionKey)
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

  const totalQuestions =
    2 + PERSONALITY_QUESTIONS.length + SCENARIO_QUESTIONS.length + EQ_QUESTIONS.length;
  const answeredCount =
    2 +
    Object.keys(personalityAnswers).length +
    Object.keys(scenarioAnswers).length +
    Object.keys(eqAnswers).length;
  const isQuestionsComplete = totalQuestions === answeredCount;
  const canSubmit = isQuestionsComplete;

  if (loading) {
    return (
      <Layout>
        <div className="flex-grow flex items-center justify-center">
          <p className="text-gray-500">Loading...</p>
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

  if (!candidate) return null;

  return (
    <Layout>
      <div ref={topRef} className="p-6 max-w-lg mx-auto w-full pb-32 space-y-10">
        <div className="text-center border-b pb-4">
          <h1 className="text-2xl font-bold text-[#005EB8]">Leadership & Career Assessment</h1>
          <p className="text-gray-600 text-sm mt-1">
            Please answer honestly. Answers from your initial application are already on file where
            needed.
          </p>
        </div>

        {/* Core drivers (1–10 sliders) */}
        <div className="space-y-6">
          <h2 className="text-xl font-bold text-gray-900">Core drivers (1–10)</h2>
          <div className="space-y-4">
            {renderScale1to10(
              'On a scale of 1–10, how competitive are you?',
              competitiveness,
              setCompetitiveness,
            )}
            {renderScale1to10(
              'On a scale of 1–10, how motivated are you by income growth?',
              moneyMotivation,
              setMoneyMotivation,
            )}
          </div>
        </div>

        {/* Open-ended questions */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Open-ended questions</h2>
          {OPEN_ENDED_QUESTIONS.map((q) => (
            <div key={q.id} className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">{q.question}</label>
              <textarea
                rows={3}
                className="w-full p-3 rounded-lg border border-gray-300 focus:ring-[#005EB8] focus:ring-2 focus:outline-none"
                value={openEndedAnswers[q.id] || ''}
                onChange={(e) =>
                  setOpenEndedAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>

        {/* Personality Profile */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Personality Profile</h2>
          {PERSONALITY_QUESTIONS.map((q) => renderPersonality(q.id, q.question))}
        </div>

        {/* Scenario & Preference Questions */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Scenario & Preference Questions</h2>
          {SCENARIO_QUESTIONS.map((q) => renderScenario(q.id, q.question, q.options))}
        </div>

        {/* Entrepreneurial Quotient Test */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Entrepreneurial Quotient (EQ) Test</h2>
          {EQ_QUESTIONS.map((q) => renderEq(q.id, q.question))}
        </div>

        <div className="pt-4 border-t">
          <p className="text-xs text-gray-500 mb-4">Progress: {Math.round((answeredCount / totalQuestions) * 100)}% of assessment questions completed.</p>
          <Button
            fullWidth
            disabled={!canSubmit || submitting}
            onClick={handleSubmit}
          >
            {submitting ? 'Submitting...' : 'Submit Assessment'}
          </Button>
        </div>
      </div>
    </Layout>
  );
};

export default AssessmentRoomForm;
