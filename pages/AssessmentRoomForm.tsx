import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import AssessmentLoadingScreen from '../components/assessment/AssessmentLoadingScreen';
import { Button } from '../components/UI';
import { getCandidateById, saveCandidate, calculateScore } from '../services/storageService';
import { triggerPostAssessmentSubmitEmail } from '../services/candidateEmailTrigger';
import {
  Candidate,
  AssessmentData,
  ApplicantQuestionnaire,
  DEFAULT_ADMIN_DATA,
  pipelineStageAfterAssessmentComplete,
} from '../types';
import {
  OPEN_ENDED_QUESTIONS,
  PERSONALITY_QUESTIONS,
  PERSONALITY_LIKERT_OPTIONS,
  SCENARIO_QUESTIONS,
  EQ_QUESTIONS,
  EQ_LIKERT_OPTIONS,
  type LikertOptionKey,
} from '../services/assessmentConfig';

function candidateWelcomeName(candidate: Candidate): string {
  const full = `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim();
  if (full) return full;
  const emailLocal = candidate.email?.split('@')[0]?.trim();
  if (emailLocal) return emailLocal;
  return 'there';
}

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

  // --- Merged "exit" / applicant questionnaire (captured at the end of the leadership assessment). ---
  const [mergedAnswers, setMergedAnswers] = useState({
    whatStoodOut: '',
    whyGoodFit: '',
    financialInvestmentLicense: '' as '' | 'yes' | 'no',
    legallyEntitledCanadaFullTime: '' as '' | 'yes' | 'no',
    comfortableVirtualEnvironment: '' as '' | 'yes' | 'no',
    excitedOffSiteSocial: '' as '' | 'yes' | 'no' | 'maybe',
    positionInterest: '' as '' | 'Leadership Career Track' | 'Agent Career Track',
    questionsAboutOpportunity: '',
    contactPermission: '' as '' | 'yes' | 'no',
    backgroundCheckWilling: '' as '' | 'yes' | 'no',
  });
  const [mergedErrors, setMergedErrors] = useState<Record<string, string>>({});

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

  const handleSubmit = async () => {
    if (!candidate || submitting) return;

    const aq = candidate.applicantQuestionnaire;

    const validateMerged = (): boolean => {
      const e: Record<string, string> = {};
      if (!mergedAnswers.whatStoodOut.trim()) e.whatStoodOut = 'Required';
      if (!mergedAnswers.whyGoodFit.trim()) e.whyGoodFit = 'Required';
      if (mergedAnswers.financialInvestmentLicense !== 'yes' && mergedAnswers.financialInvestmentLicense !== 'no')
        e.financialInvestmentLicense = 'Required';
      if (mergedAnswers.legallyEntitledCanadaFullTime !== 'yes' && mergedAnswers.legallyEntitledCanadaFullTime !== 'no')
        e.legallyEntitledCanadaFullTime = 'Required';
      if (mergedAnswers.comfortableVirtualEnvironment !== 'yes' && mergedAnswers.comfortableVirtualEnvironment !== 'no')
        e.comfortableVirtualEnvironment = 'Required';
      if (!mergedAnswers.excitedOffSiteSocial) e.excitedOffSiteSocial = 'Required';
      if (!mergedAnswers.positionInterest) e.positionInterest = 'Required';
      if (!mergedAnswers.questionsAboutOpportunity.trim()) e.questionsAboutOpportunity = 'Required';
      if (mergedAnswers.contactPermission !== 'yes' && mergedAnswers.contactPermission !== 'no') e.contactPermission = 'Required';
      if (mergedAnswers.backgroundCheckWilling !== 'yes' && mergedAnswers.backgroundCheckWilling !== 'no')
        e.backgroundCheckWilling = 'Required';

      setMergedErrors(e);
      return Object.keys(e).length === 0;
    };

    if (!validateMerged()) return;

    const assessmentData: AssessmentData = {
      occupation: aq?.occupation || background.occupation,
      currentRole: aq?.currentRole || background.currentRole,
      backgroundAreas: aq?.backgroundAreas?.length ? aq.backgroundAreas : background.areas,
      salesExperience: aq?.salesExperience || background.salesExperience,
      competitiveness,
      moneyMotivation,
      openEndedAnswers,
      personalityAnswers,
      scenarioAnswers,
      eqAnswers,
    };

    const { score, fitCategory } = calculateScore(assessmentData);

    const updatedCandidate: Candidate = {
      ...candidate,
      status: 'assessment_complete',
      assessment: assessmentData,
      score,
      fitCategory,
      adminData: {
        ...DEFAULT_ADMIN_DATA,
        ...candidate.adminData,
        pipelineStage: pipelineStageAfterAssessmentComplete(candidate.adminData?.pipelineStage),
      },
      applicantQuestionnaire: {
        occupation: aq?.occupation || background.occupation,
        currentRole: aq?.currentRole || background.currentRole,
        backgroundAreas: aq?.backgroundAreas?.length ? aq.backgroundAreas : background.areas,
        salesExperience: aq?.salesExperience || background.salesExperience,
        somethingAboutYourself: aq?.somethingAboutYourself || '',
        legallyEntitledCanada: aq?.legallyEntitledCanada || 'yes',
        resumeUrls: aq?.resumeUrls || [],
        linkedinProfileUrl: aq?.linkedinProfileUrl,
        whatStoodOut: mergedAnswers.whatStoodOut.trim(),
        whyGoodFit: mergedAnswers.whyGoodFit.trim(),
        financialInvestmentLicense: mergedAnswers.financialInvestmentLicense as 'yes' | 'no',
        legallyEntitledCanadaFullTime: mergedAnswers.legallyEntitledCanadaFullTime as 'yes' | 'no',
        comfortableVirtualEnvironment: mergedAnswers.comfortableVirtualEnvironment as 'yes' | 'no',
        excitedOffSiteSocial: mergedAnswers.excitedOffSiteSocial as 'yes' | 'no' | 'maybe',
        positionInterest:
          mergedAnswers.positionInterest === 'Leadership Career Track'
            ? 'Leadership'
            : 'Advisor',
        questionsAboutOpportunity: mergedAnswers.questionsAboutOpportunity.trim(),
        contactPermission: mergedAnswers.contactPermission as 'yes' | 'no',
        backgroundCheckWilling: mergedAnswers.backgroundCheckWilling as 'yes' | 'no',
      },
    };

    try {
      setSubmitting(true);
      await saveCandidate(updatedCandidate);
      await triggerPostAssessmentSubmitEmail(updatedCandidate.id, updatedCandidate.email);
      navigate('/thank-you', { state: { fromMergedAssessment: true } });
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

  const renderPersonality = (qId: number, text: string) => {
    const val = personalityAnswers[qId];
    return (
      <div className="bg-white p-6 rounded-xl border border-gray-200 space-y-3" key={qId}>
        <p className="font-medium text-gray-800">{text}</p>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(PERSONALITY_LIKERT_OPTIONS).map(([key, opt]) => (
            <button
              key={key}
              type="button"
              onClick={() =>
                setPersonalityAnswers(prev => ({ ...prev, [qId]: key as LikertOptionKey }))
              }
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

  const renderScenario = (qId: number, text: string, options: Record<string, string>) => {
    const val = scenarioAnswers[qId];
    return (
      <div className="bg-white p-6 rounded-xl border border-gray-200 space-y-3" key={qId}>
        <p className="font-medium text-gray-800">{text}</p>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(options).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setScenarioAnswers(prev => ({ ...prev, [qId]: key }))}
              className={`py-2 px-3 text-sm rounded-lg border transition-all ${
                val === key
                  ? 'bg-[#005EB8] text-white border-[#005EB8]'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-200'
              }`}
            >
              {label}
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
  const isMergedComplete =
    !!mergedAnswers.whatStoodOut.trim() &&
    !!mergedAnswers.whyGoodFit.trim() &&
    !!mergedAnswers.financialInvestmentLicense &&
    !!mergedAnswers.legallyEntitledCanadaFullTime &&
    !!mergedAnswers.comfortableVirtualEnvironment &&
    !!mergedAnswers.excitedOffSiteSocial &&
    !!mergedAnswers.positionInterest &&
    !!mergedAnswers.questionsAboutOpportunity.trim() &&
    !!mergedAnswers.contactPermission &&
    !!mergedAnswers.backgroundCheckWilling;
  const canSubmit = isQuestionsComplete && isMergedComplete;

  if (loading) {
    return <AssessmentLoadingScreen />;
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
        <div className="text-center border-b pb-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#005EB8]/80">Leadership & Career Assessment</p>
          <h1 className="text-2xl font-bold text-[#0B1B34] mt-2">
            Welcome, {candidateWelcomeName(candidate)}
          </h1>
          <p className="text-gray-600 text-sm mt-2 max-w-md mx-auto">
            This questionnaire is for you personally — please fill it out honestly. Your responses help
            our Leadership Team review your fit for the next step.
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

        {/* Merged Applicant Questionnaire */}
        <div className="space-y-4 pt-8 border-t">
          <div className="space-y-2">
            <h2 className="text-xl font-bold text-gray-900">Applicant Questionnaire</h2>
            <p className="text-sm text-gray-600">Please answer the following Questions.</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                What stood out to you most about our career opportunity? <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={mergedAnswers.whatStoodOut}
                onChange={(e) => setMergedAnswers((p) => ({ ...p, whatStoodOut: e.target.value }))}
                className={`w-full p-3 rounded-lg border ${mergedErrors.whatStoodOut ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-[#005EB8]'} focus:ring-2 focus:outline-none bg-white`}
              />
              {mergedErrors.whatStoodOut && <p className="mt-1 text-xs text-red-600">{mergedErrors.whatStoodOut}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Why do you feel you would be a good fit for our organization? <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                value={mergedAnswers.whyGoodFit}
                onChange={(e) => setMergedAnswers((p) => ({ ...p, whyGoodFit: e.target.value }))}
                className={`w-full p-3 rounded-lg border ${mergedErrors.whyGoodFit ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-[#005EB8]'} focus:ring-2 focus:outline-none bg-white`}
              />
              {mergedErrors.whyGoodFit && <p className="mt-1 text-xs text-red-600">{mergedErrors.whyGoodFit}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                If you were offered an opportunity to join our organization, would you be prepared to make the financial investment to obtain your license?{' '}
                <span className="text-red-500">*</span>{' '}
                <span className="text-gray-600 font-normal">[$348 tuition fees for LLQP Registration]</span>
              </label>
              <div className="text-[12px] text-gray-500 mb-2 leading-relaxed">
                <a href="https://partners.remic.ca/globe-life-paz/" target="_blank" rel="noopener noreferrer" className="text-[#005EB8] underline">
                  Course provider
                </a>
                &nbsp;|&nbsp;
                <a href="https://www.fsrao.ca/licensing/life-and-accident-sickness-agent" target="_blank" rel="noopener noreferrer" className="text-[#005EB8] underline">
                  Provincial Regulator
                </a>
              </div>
              <select
                value={mergedAnswers.financialInvestmentLicense}
                onChange={(e) => setMergedAnswers((p) => ({ ...p, financialInvestmentLicense: e.target.value as any }))}
                className={`w-full px-4 py-3 rounded-lg border ${mergedErrors.financialInvestmentLicense ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-[#005EB8]'} focus:ring-2 focus:outline-none bg-white`}
              >
                <option value="" disabled>Select an option</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
              {mergedErrors.financialInvestmentLicense && (
                <p className="mt-1 text-xs text-red-600">{mergedErrors.financialInvestmentLicense}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Are you legally entitled to work in Canada on a FULL-TIME BASIS? <span className="text-red-500">*</span>
              </label>
              <select
                value={mergedAnswers.legallyEntitledCanadaFullTime}
                onChange={(e) => setMergedAnswers((p) => ({ ...p, legallyEntitledCanadaFullTime: e.target.value as any }))}
                className={`w-full px-4 py-3 rounded-lg border ${mergedErrors.legallyEntitledCanadaFullTime ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-[#005EB8]'} focus:ring-2 focus:outline-none bg-white`}
              >
                <option value="" disabled>Select an option</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
              {mergedErrors.legallyEntitledCanadaFullTime && (
                <p className="mt-1 text-xs text-red-600">{mergedErrors.legallyEntitledCanadaFullTime}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Are you comfortable with working in a 100% virtual environment ? <span className="text-red-500">*</span>
              </label>
              <select
                value={mergedAnswers.comfortableVirtualEnvironment}
                onChange={(e) => setMergedAnswers((p) => ({ ...p, comfortableVirtualEnvironment: e.target.value as any }))}
                className={`w-full px-4 py-3 rounded-lg border ${mergedErrors.comfortableVirtualEnvironment ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-[#005EB8]'} focus:ring-2 focus:outline-none bg-white`}
              >
                <option value="" disabled>Select an option</option>
                <option value="yes">YES</option>
                <option value="no">NO</option>
              </select>
              {mergedErrors.comfortableVirtualEnvironment && (
                <p className="mt-1 text-xs text-red-600">{mergedErrors.comfortableVirtualEnvironment}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                If we welcome you to our team, would you be excited to join our lively off-site social functions? These are fantastic opportunities to connect with colleagues, meet leadership, and build lasting relationships. <span className="text-red-500">*</span>
              </label>
              <select
                value={mergedAnswers.excitedOffSiteSocial}
                onChange={(e) => setMergedAnswers((p) => ({ ...p, excitedOffSiteSocial: e.target.value as any }))}
                className={`w-full px-4 py-3 rounded-lg border ${mergedErrors.excitedOffSiteSocial ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-[#005EB8]'} focus:ring-2 focus:outline-none bg-white`}
              >
                <option value="" disabled>Select an option</option>
                <option value="yes">YES</option>
                <option value="no">NO</option>
                <option value="maybe">Maybe</option>
              </select>
              {mergedErrors.excitedOffSiteSocial && (
                <p className="mt-1 text-xs text-red-600">{mergedErrors.excitedOffSiteSocial}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Which position would you be the most interested in being considered for? <span className="text-red-500">*</span>
              </label>
              <select
                value={mergedAnswers.positionInterest}
                onChange={(e) => setMergedAnswers((p) => ({ ...p, positionInterest: e.target.value as any }))}
                className={`w-full px-4 py-3 rounded-lg border ${mergedErrors.positionInterest ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-[#005EB8]'} focus:ring-2 focus:outline-none bg-white`}
              >
                <option value="" disabled>Select an option</option>
                <option value="Leadership Career Track">Leadership Career Track</option>
                <option value="Agent Career Track">Agent Career Track</option>
              </select>
              {mergedErrors.positionInterest && <p className="mt-1 text-xs text-red-600">{mergedErrors.positionInterest}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                What questions, if any, do you have about the career opportunity? <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={2}
                value={mergedAnswers.questionsAboutOpportunity}
                onChange={(e) => setMergedAnswers((p) => ({ ...p, questionsAboutOpportunity: e.target.value }))}
                className={`w-full p-3 rounded-lg border ${mergedErrors.questionsAboutOpportunity ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-[#005EB8]'} focus:ring-2 focus:outline-none bg-white`}
              />
              {mergedErrors.questionsAboutOpportunity && (
                <p className="mt-1 text-xs text-red-600">{mergedErrors.questionsAboutOpportunity}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Contact Permission <span className="text-red-500">*</span>
              </label>
              <select
                value={mergedAnswers.contactPermission}
                onChange={(e) => setMergedAnswers((p) => ({ ...p, contactPermission: e.target.value as any }))}
                className={`w-full px-4 py-3 rounded-lg border ${mergedErrors.contactPermission ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-[#005EB8]'} focus:ring-2 focus:outline-none bg-white`}
              >
                <option value="" disabled>Select an option</option>
                <option value="yes">Yes, I agree to receiving communications regarding future career opportunities</option>
                <option value="no">No, I do not agree to receiving communications regarding future career opportunities</option>
              </select>
              {mergedErrors.contactPermission && (
                <p className="mt-1 text-xs text-red-600">{mergedErrors.contactPermission}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                As per regulatory requirements, would you be willing to complete a BACKGROUND CHECK to ensure Advisor/Leader Suitability?{' '}
                <span className="text-red-500">*</span>
              </label>
              <select
                value={mergedAnswers.backgroundCheckWilling}
                onChange={(e) => setMergedAnswers((p) => ({ ...p, backgroundCheckWilling: e.target.value as any }))}
                className={`w-full px-4 py-3 rounded-lg border ${mergedErrors.backgroundCheckWilling ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-[#005EB8]'} focus:ring-2 focus:outline-none bg-white`}
              >
                <option value="" disabled>Select an option</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
              {mergedErrors.backgroundCheckWilling && (
                <p className="mt-1 text-xs text-red-600">{mergedErrors.backgroundCheckWilling}</p>
              )}
            </div>
          </div>
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
