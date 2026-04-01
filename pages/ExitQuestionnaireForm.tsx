import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button, Input, Select } from '../components/UI';
import { createCandidate, getCandidateByEmail, saveCandidate, DuplicateApplicationError } from '../services/storageService';
import type { PostLiveExitQuestionnaire } from '../types';

const POSITION_OPTIONS = [
  { value: 'Advisor', label: 'Advisor' },
  { value: 'Leadership', label: 'Leadership' },
];

const CONTACT_PERMISSION_OPTIONS = [
  { value: 'yes', label: 'Yes, I agree to receiving communications regarding future career opportunities' },
  { value: 'no', label: 'No, I do not agree to receiving communications regarding future career opportunities' },
];

const ExitQuestionnaireForm: React.FC = () => {
  const navigate = useNavigate();
  const [loadEmail, setLoadEmail] = useState('');
  const [loadLookupError, setLoadLookupError] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    verifyEmail: '',
    phone: '',
    whatStoodOut: '',
    whyGoodFit: '',
    financialInvestmentLicense: '' as '' | 'yes' | 'no',
    legallyEntitledCanadaFullTime: '' as '' | 'yes' | 'no',
    comfortableVirtualEnvironment: '' as '' | 'yes' | 'no',
    excitedOffSiteSocial: '' as '' | 'yes' | 'no' | 'maybe',
    positionInterest: '',
    questionsAboutOpportunity: '',
    contactPermission: '' as '' | 'yes' | 'no',
  });

  const update = (key: keyof typeof form, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors(prev => ({ ...prev, [key]: '' }));
  };

  const handleLoadByEmail = async () => {
    const email = loadEmail.trim().toLowerCase();
    if (!email) {
      setLoadLookupError('Please enter your email.');
      return;
    }
    setLoadLookupError('');
    setLookupLoading(true);
    try {
      const c = await getCandidateByEmail(email);
      if (!c) {
        setLoadLookupError('No record found for this email. You can still fill out the form below.');
        setLookupLoading(false);
        return;
      }
      const eq = c.exitQuestionnaire;
      setForm(prev => ({
        ...prev,
        firstName: c.firstName || prev.firstName,
        lastName: c.lastName || prev.lastName,
        email: c.email || prev.email,
        verifyEmail: c.email || prev.verifyEmail,
        phone: c.phone || prev.phone,
        ...(eq ? {
          whatStoodOut: eq.whatStoodOut || prev.whatStoodOut,
          whyGoodFit: eq.whyGoodFit || prev.whyGoodFit,
          financialInvestmentLicense: eq.financialInvestmentLicense || prev.financialInvestmentLicense,
          legallyEntitledCanadaFullTime: eq.legallyEntitledCanadaFullTime || prev.legallyEntitledCanadaFullTime,
          comfortableVirtualEnvironment: eq.comfortableVirtualEnvironment || prev.comfortableVirtualEnvironment,
          excitedOffSiteSocial: eq.excitedOffSiteSocial || prev.excitedOffSiteSocial,
          positionInterest: (eq.positionInterest === 'Leadership Career Track' ? 'Leadership' : eq.positionInterest === 'Agent Career Track' ? 'Advisor' : eq.positionInterest) || prev.positionInterest,
          questionsAboutOpportunity: eq.questionsAboutOpportunity || prev.questionsAboutOpportunity,
          contactPermission: eq.contactPermission || prev.contactPermission,
        } : {}),
      }));
    } catch (err) {
      console.error(err);
      setLoadLookupError('Could not load your record. Please try again.');
    } finally {
      setLookupLoading(false);
    }
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim()) e.lastName = 'Required';
    if (!form.email.trim()) e.email = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Please enter a valid email';
    if (form.email !== form.verifyEmail) e.verifyEmail = 'Email addresses must match';
    if (!form.phone.trim()) e.phone = 'Required';
    if (!form.whatStoodOut.trim()) e.whatStoodOut = 'Required';
    if (!form.whyGoodFit.trim()) e.whyGoodFit = 'Required';
    if (form.financialInvestmentLicense !== 'yes' && form.financialInvestmentLicense !== 'no') e.financialInvestmentLicense = 'Required';
    if (form.legallyEntitledCanadaFullTime !== 'yes' && form.legallyEntitledCanadaFullTime !== 'no') e.legallyEntitledCanadaFullTime = 'Required';
    if (form.comfortableVirtualEnvironment !== 'yes' && form.comfortableVirtualEnvironment !== 'no') e.comfortableVirtualEnvironment = 'Required';
    if (form.excitedOffSiteSocial !== 'yes' && form.excitedOffSiteSocial !== 'no' && form.excitedOffSiteSocial !== 'maybe') e.excitedOffSiteSocial = 'Required';
    if (!form.positionInterest) e.positionInterest = 'Required';
    if (form.contactPermission !== 'yes' && form.contactPermission !== 'no') e.contactPermission = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || submitting) return;

    const payload: PostLiveExitQuestionnaire = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.replace(/\D/g, '').trim() || form.phone.trim(),
      whatStoodOut: form.whatStoodOut.trim(),
      whyGoodFit: form.whyGoodFit.trim(),
      financialInvestmentLicense: form.financialInvestmentLicense as 'yes' | 'no',
      legallyEntitledCanadaFullTime: form.legallyEntitledCanadaFullTime as 'yes' | 'no',
      comfortableVirtualEnvironment: form.comfortableVirtualEnvironment as 'yes' | 'no',
      excitedOffSiteSocial: form.excitedOffSiteSocial as 'yes' | 'no' | 'maybe',
      positionInterest: form.positionInterest,
      questionsAboutOpportunity: form.questionsAboutOpportunity.trim(),
      contactPermission: form.contactPermission as 'yes' | 'no',
      submittedAt: new Date().toISOString(),
    };

    setSubmitting(true);
    try {
      const existing = await getCandidateByEmail(payload.email);
      if (existing) {
        await saveCandidate({ ...existing, exitQuestionnaire: payload });
      } else {
        await createCandidate({
          firstName: payload.firstName,
          lastName: payload.lastName,
          email: payload.email,
          phone: payload.phone,
          city: '',
          exitQuestionnaire: payload,
        });
      }
      navigate('/thank-you', { state: { fromExitQuestionnaire: true } });
    } catch (err) {
      console.error(err);
      if (err instanceof DuplicateApplicationError) {
        setErrors(prev => ({ ...prev, _form: err.message }));
      } else {
        setErrors(prev => ({ ...prev, _form: 'Something went wrong. Please try again.' }));
      }
      setSubmitting(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Post Live Career Overview Exit Questionnaire</h1>
        <p className="text-gray-600 mb-6">Applicant Questionnaire — please complete all required fields.</p>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6 space-y-3">
          <p className="text-sm font-medium text-gray-700">Already in our system? Enter your email to load your information.</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="email"
              value={loadEmail}
              onChange={e => { setLoadEmail(e.target.value); setLoadLookupError(''); }}
              placeholder="your@email.com"
              className="flex-1 min-h-[48px] px-4 py-3 rounded-lg border border-gray-300 focus:ring-[#005EB8] focus:border-[#005EB8] focus:outline-none focus:ring-2"
            />
            <Button type="button" variant="outline" onClick={handleLoadByEmail} disabled={lookupLoading}>
              {lookupLoading ? 'Loading...' : 'Fetch my info'}
            </Button>
          </div>
          {loadLookupError && <p className="text-sm text-amber-700">{loadLookupError}</p>}
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="First Name"
              required
              value={form.firstName}
              onChange={e => update('firstName', e.target.value)}
              error={errors.firstName}
            />
            <Input
              label="Last Name"
              required
              value={form.lastName}
              onChange={e => update('lastName', e.target.value)}
              error={errors.lastName}
            />
          </div>
          <Input
            label="Verify Email Address"
            type="email"
            required
            value={form.email}
            onChange={e => update('email', e.target.value)}
            error={errors.email}
            placeholder="your@email.com"
          />
          <Input
            label="Confirm Email Address"
            type="email"
            required
            value={form.verifyEmail}
            onChange={e => update('verifyEmail', e.target.value)}
            error={errors.verifyEmail}
            placeholder="re-enter your email"
          />
          <Input
            label="Phone number"
            type="tel"
            required
            value={form.phone}
            onChange={e => update('phone', e.target.value)}
            error={errors.phone}
          />

          <div className="border-t border-gray-200 pt-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Applicant Questionnaire</h2>
            <p className="text-sm text-gray-600 mb-4">Please answer the following questions. These help us determine eligibility for final interview callbacks.</p>
          </div>

          {/* Eligibility questions at top (last QR — exit form) */}
          <Select
            label="1. If you were offered an opportunity to join our company, would you be prepared to make the financial investment to obtain your license [Tuition $348]?"
            required
            options={[
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
            value={form.financialInvestmentLicense}
            onChange={e => update('financialInvestmentLicense', e.target.value)}
            error={errors.financialInvestmentLicense}
          />
          <Select
            label="2. Are you comfortable working in a 100% virtual environment?"
            required
            options={[
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
            value={form.comfortableVirtualEnvironment}
            onChange={e => update('comfortableVirtualEnvironment', e.target.value)}
            error={errors.comfortableVirtualEnvironment}
          />
          <Select
            label="3. Which career path are you most interested in?"
            required
            options={POSITION_OPTIONS}
            value={form.positionInterest}
            onChange={e => update('positionInterest', e.target.value)}
            error={errors.positionInterest}
          />

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              What stood out to you most about our career opportunity? <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={form.whatStoodOut}
              onChange={e => update('whatStoodOut', e.target.value)}
              className={`w-full px-4 py-3 rounded-lg border ${errors.whatStoodOut ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-[#005EB8]'} focus:outline-none focus:ring-2 transition-all bg-white`}
            />
            {errors.whatStoodOut && <p className="mt-1 text-xs text-red-600">{errors.whatStoodOut}</p>}
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Why do you feel you would be a good fit for our organization? <span className="text-red-500">*</span>
            </label>
            <textarea
              required
              rows={3}
              value={form.whyGoodFit}
              onChange={e => update('whyGoodFit', e.target.value)}
              className={`w-full px-4 py-3 rounded-lg border ${errors.whyGoodFit ? 'border-red-500 focus:ring-red-500' : 'border-gray-300 focus:ring-[#005EB8]'} focus:outline-none focus:ring-2 transition-all bg-white`}
            />
            {errors.whyGoodFit && <p className="mt-1 text-xs text-red-600">{errors.whyGoodFit}</p>}
          </div>

          <Select
            label="Are you legally entitled to work in Canada on a FULL-TIME BASIS?"
            required
            options={[
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
            value={form.legallyEntitledCanadaFullTime}
            onChange={e => update('legallyEntitledCanadaFullTime', e.target.value)}
            error={errors.legallyEntitledCanadaFullTime}
          />

          <Select
            label="If we welcome you to our team, would you be excited to join our lively off-site social functions? These are fantastic opportunities to connect with colleagues, meet leadership, and build lasting relationships."
            required
            options={[
              { value: 'yes', label: 'YES' },
              { value: 'no', label: 'NO' },
              { value: 'maybe', label: 'Maybe' },
            ]}
            value={form.excitedOffSiteSocial}
            onChange={e => update('excitedOffSiteSocial', e.target.value)}
            error={errors.excitedOffSiteSocial}
          />

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">What questions, if any, do you have about the career opportunity?</label>
            <textarea
              rows={2}
              value={form.questionsAboutOpportunity}
              onChange={e => update('questionsAboutOpportunity', e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-[#005EB8] focus:outline-none focus:ring-2 transition-all bg-white"
            />
          </div>

          <Select
            label="Contact Permission"
            required
            options={CONTACT_PERMISSION_OPTIONS}
            value={form.contactPermission}
            onChange={e => update('contactPermission', e.target.value)}
            error={errors.contactPermission}
          />

          {errors._form && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{errors._form}</p>
          )}

          <Button type="submit" fullWidth disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit'}
          </Button>
        </form>
      </div>
    </Layout>
  );
};

export default ExitQuestionnaireForm;
