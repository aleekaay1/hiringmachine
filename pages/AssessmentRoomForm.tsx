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

  // Eligibility (at top)
  const [eligibility, setEligibility] = useState({
    financialInvestmentLicense: '' as '' | 'yes' | 'no',
    comfortableVirtualEnvironment: '' as '' | 'yes' | 'no',
    careerPathInterest: '' as '' | 'Advisor' | 'Leadership',
  });

  // Section 3: Questions
  const [competitiveness, setCompetitiveness] = useState<number>(5);
  const [moneyMotivation, setMoneyMotivation] = useState<number>(5);
  const [likertResponses, setLikertResponses] = useState<Record<number, number>>({});
  const [trueScaleResponses, setTrueScaleResponses] = useState<Record<number, number>>({});

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
          const eq = c.exitQuestionnaire;
          if (aq) {
            setBackground(prev => ({
              ...prev,
              occupation: aq.occupation || prev.occupation,
              currentRole: aq.currentRole || prev.currentRole,
              areas: Array.isArray(aq.backgroundAreas) ? aq.backgroundAreas.filter((a: string) => ASSESSMENT_ROOM_BACKGROUND_AREAS.includes(a as any)) : prev.areas,
              salesExperience: aq.salesExperience || prev.salesExperience,
            }));
            if (aq.financialInvestmentLicense) setEligibility(prev => ({ ...prev, financialInvestmentLicense: aq.financialInvestmentLicense }));
            if (aq.comfortableVirtualEnvironment) setEligibility(prev => ({ ...prev, comfortableVirtualEnvironment: aq.comfortableVirtualEnvironment }));
            if (aq.positionInterest === 'Leadership Career Track') setEligibility(prev => ({ ...prev, careerPathInterest: 'Leadership' }));
            if (aq.positionInterest === 'Agent Career Track') setEligibility(prev => ({ ...prev, careerPathInterest: 'Advisor' }));
          }
          if (eq) {
            if (eq.financialInvestmentLicense) setEligibility(prev => ({ ...prev, financialInvestmentLicense: eq.financialInvestmentLicense }));
            if (eq.comfortableVirtualEnvironment) setEligibility(prev => ({ ...prev, comfortableVirtualEnvironment: eq.comfortableVirtualEnvironment }));
            if (eq.positionInterest === 'Leadership Career Track') setEligibility(prev => ({ ...prev, careerPathInterest: 'Leadership' }));
            if (eq.positionInterest === 'Agent Career Track') setEligibility(prev => ({ ...prev, careerPathInterest: 'Advisor' }));
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

    const assessmentData: AssessmentData = {
      financialInvestmentLicense: eligibility.financialInvestmentLicense || undefined,
      comfortableVirtualEnvironment: eligibility.comfortableVirtualEnvironment || undefined,
      careerPathInterest: eligibility.careerPathInterest || undefined,
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
      firstName: basic.firstName.trim() || candidate.firstName,
      lastName: basic.lastName.trim() || candidate.lastName,
      email: basic.email.trim() || candidate.email,
      phone: basic.phone.trim() || candidate.phone,
      city: basic.city.trim() || candidate.city,
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

  const renderTrueScale = (qId: number, text: string) => {
    const val = trueScaleResponses[qId];
    return (
      <div className="bg-white p-6 rounded-xl border border-gray-200 space-y-3" key={qId}>
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
              type="button"
              onClick={() => setTrueScaleResponses(prev => ({ ...prev, [qId]: opt.score }))}
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

  const totalQuestions = 2 + QUESTIONS.likert.length + QUESTIONS.trueScale.length;
  const answeredCount = 2 + Object.keys(likertResponses).length + Object.keys(trueScaleResponses).length;
  const isQuestionsComplete = totalQuestions === answeredCount;
  const isEligibilityValid = eligibility.financialInvestmentLicense && eligibility.comfortableVirtualEnvironment && eligibility.careerPathInterest;
  const isSection1Valid = basic.firstName.trim() && basic.lastName.trim() && basic.email.trim();
  const isSection2Valid = background.occupation && background.areas.length > 0 && background.salesExperience.trim();
  const canSubmit = isEligibilityValid && isSection1Valid && isSection2Valid && isQuestionsComplete;

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
          <p className="text-gray-600 text-sm mt-1">Please complete all sections. Answers from your initial application are pre-filled where available.</p>
        </div>

        {/* Eligibility — at top */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Eligibility — Final Interview</h2>
          <p className="text-gray-500 text-sm">These answers help us determine eligibility for final interview callbacks.</p>
          <Select
            label="1. If you were offered an opportunity to join our company, would you be prepared to make the financial investment to obtain your license?"
            value={eligibility.financialInvestmentLicense}
            onChange={(e) => setEligibility({ ...eligibility, financialInvestmentLicense: e.target.value as 'yes' | 'no' })}
            options={[
              { value: '', label: 'Select...' },
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
            required
          />
          <Select
            label="2. Are you comfortable working in a 100% virtual environment?"
            value={eligibility.comfortableVirtualEnvironment}
            onChange={(e) => setEligibility({ ...eligibility, comfortableVirtualEnvironment: e.target.value as 'yes' | 'no' })}
            options={[
              { value: '', label: 'Select...' },
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
            required
          />
          <Select
            label="3. Which career path are you most interested in?"
            value={eligibility.careerPathInterest}
            onChange={(e) => setEligibility({ ...eligibility, careerPathInterest: e.target.value as 'Advisor' | 'Leadership' })}
            options={[
              { value: '', label: 'Select...' },
              { value: 'Advisor', label: 'Advisor' },
              { value: 'Leadership', label: 'Leadership' },
            ]}
            required
          />
        </div>

        {/* Section 1: Basic Info */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Section 1 — Basic Information</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="First name"
              value={basic.firstName}
              onChange={(e) => setBasic({ ...basic, firstName: e.target.value })}
              required
            />
            <Input
              label="Last name"
              value={basic.lastName}
              onChange={(e) => setBasic({ ...basic, lastName: e.target.value })}
              required
            />
          </div>
          <Input
            label="Email"
            type="email"
            value={basic.email}
            onChange={(e) => setBasic({ ...basic, email: e.target.value })}
            required
          />
          <Input
            label="Phone"
            type="tel"
            value={basic.phone}
            onChange={(e) => setBasic({ ...basic, phone: e.target.value })}
          />
          <Input
            label="City"
            value={basic.city}
            onChange={(e) => setBasic({ ...basic, city: e.target.value })}
          />
        </div>

        {/* Section 2: Professional Background */}
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Section 2 — Professional Background</h2>
          <p className="text-gray-500 text-sm">Pre-filled from your initial application if you completed it. You can update if needed.</p>
          <Select
            label="Current occupation and employment status"
            value={background.occupation}
            onChange={(e) => setBackground({ ...background, occupation: e.target.value })}
            options={[
              { value: '', label: 'Select...' },
              { value: 'full-time', label: 'Employed full-time' },
              { value: 'part-time', label: 'Employed part-time' },
              { value: 'self-employed', label: 'Self-employed' },
              { value: 'student', label: 'Student' },
              { value: 'unemployed', label: 'Not currently employed' },
            ]}
            required
          />
          <Input
            label="Current role / company (if applicable)"
            value={background.currentRole}
            onChange={(e) => setBackground({ ...background, currentRole: e.target.value })}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Which areas best describe your background? (Select all that apply) <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2">
              {ASSESSMENT_ROOM_BACKGROUND_AREAS.map(area => (
                <div
                  key={area}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleAreaToggle(area)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAreaToggle(area)}
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
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Briefly describe any experience in sales, leadership, or generating revenue <span className="text-red-500">*</span>
            </label>
            <textarea
              className="w-full p-3 rounded-lg border border-gray-300 focus:ring-[#005EB8] focus:ring-2 focus:outline-none min-h-[120px]"
              value={background.salesExperience}
              onChange={(e) => setBackground({ ...background, salesExperience: e.target.value })}
              required
            />
          </div>
        </div>

        {/* Section 3: Leadership & EQ */}
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Section 3 — Leadership & EQ Assessment</h2>
            <p className="text-gray-500 text-sm mt-1">Please answer honestly. There are no right or wrong answers.</p>
          </div>
          <div className="space-y-4">
            {renderScale1to10('On a scale of 1–10, how competitive are you?', competitiveness, setCompetitiveness)}
            {renderScale1to10('On a scale of 1–10, how motivated are you by income growth?', moneyMotivation, setMoneyMotivation)}
          </div>
          <div className="space-y-4">
            {QUESTIONS.likert.map(q => renderLikert(q.id, q.text))}
          </div>
          <div className="space-y-4">
            {QUESTIONS.trueScale.map(q => renderTrueScale(q.id, q.text))}
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
