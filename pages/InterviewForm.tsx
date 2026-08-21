import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button, Input } from '../components/UI';
import {
  createCandidate,
  saveCandidate,
  DuplicateApplicationError,
} from '../services/storageService';
import { DEFAULT_ADMIN_DATA, PIPELINE_STAGE_AFTER_CHECK_IN } from '../types';

/**
 * Instantly campaign landing form — short tracking check-in only.
 * Put this URL in Instantly instead of the AO Hub link so we can see who showed up.
 */
const InterviewForm: React.FC = () => {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    city: '',
    currentRole: '',
  });

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim()) e.lastName = 'Required';
    if (!form.email.trim()) e.email = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email';
    if (!form.phone.trim()) e.phone = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      setSubmitting(true);
      setErrors({});
      const now = new Date().toISOString();
      const created = await createCandidate({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.replace(/\D/g, ''),
        city: form.city.trim(),
        applicantQuestionnaire: {
          occupation: '',
          currentRole: form.currentRole.trim(),
          backgroundAreas: [],
          salesExperience: '',
          somethingAboutYourself: '',
          legallyEntitledCanada: 'yes',
          resumeUrls: [],
        },
      });
      await saveCandidate({
        ...created,
        adminData: {
          ...DEFAULT_ADMIN_DATA,
          ...created.adminData,
          pipelineStage: PIPELINE_STAGE_AFTER_CHECK_IN,
          checkedInAt: now,
          tags: Array.from(
            new Set([...(created.adminData?.tags || []), 'instantly_checkin']),
          ),
          nextStep: 'Awaiting shortlist / AO Hub invite',
        },
      });
      navigate('/thank-you', { state: { fromCheckin: true } });
    } catch (err) {
      console.error(err);
      if (err instanceof DuplicateApplicationError) {
        setErrors({ _form: err.message });
      } else {
        setErrors({ _form: 'There was an issue saving. Please try again.' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Layout compactHeader hideHeaderOnScroll>
      <div className="mx-auto flex w-full max-w-lg flex-grow flex-col items-center px-4 py-8 pb-24 text-center sm:p-6">
        <div className="mb-5 flex w-full justify-center">
          <img
            src="/header.PNG"
            alt="Globe Life AIL Division"
            className="mx-auto h-auto w-full max-w-md object-contain"
            onError={(ev) => {
              (ev.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>

        <h2 className="mb-2 w-full text-2xl font-bold text-gray-900">Check in</h2>
        <p className="mb-6 max-w-md text-sm text-gray-600">
          Tell us a little about yourself so we can follow up if you are shortlisted for the next step.
        </p>

        <form onSubmit={handleSubmit} className="w-full space-y-4 text-left">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="First Name"
              value={form.firstName}
              onChange={(ev) => setForm({ ...form, firstName: ev.target.value })}
              error={errors.firstName}
              required
            />
            <Input
              label="Last Name"
              value={form.lastName}
              onChange={(ev) => setForm({ ...form, lastName: ev.target.value })}
              error={errors.lastName}
              required
            />
          </div>
          <Input
            label="Email Address"
            type="email"
            value={form.email}
            onChange={(ev) => setForm({ ...form, email: ev.target.value })}
            error={errors.email}
            required
          />
          <Input
            label="Phone Number"
            type="tel"
            value={form.phone}
            onChange={(ev) => setForm({ ...form, phone: ev.target.value })}
            error={errors.phone}
            required
          />
          <Input
            label="City (optional)"
            value={form.city}
            onChange={(ev) => setForm({ ...form, city: ev.target.value })}
          />
          <Input
            label="Current role / company (optional)"
            value={form.currentRole}
            onChange={(ev) => setForm({ ...form, currentRole: ev.target.value })}
          />

          {errors._form && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {errors._form}
            </p>
          )}

          <Button type="submit" fullWidth disabled={submitting} className="min-h-[48px]">
            {submitting ? 'Submitting…' : 'Submit'}
          </Button>
        </form>
      </div>
    </Layout>
  );
};

export default InterviewForm;
