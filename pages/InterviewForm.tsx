import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button, Input, Select } from '../components/UI';
import {
  createCandidate,
  saveCandidate,
  DuplicateApplicationError,
} from '../services/storageService';
import { notifyCheckInStaff } from '../services/checkInService';
import { DEFAULT_ADMIN_DATA, PIPELINE_STAGE_AFTER_CHECK_IN } from '../types';

const PROVINCE_OPTIONS = [
  { value: 'AB', label: 'Alberta' },
  { value: 'BC', label: 'British Columbia' },
  { value: 'MB', label: 'Manitoba' },
  { value: 'NB', label: 'New Brunswick' },
  { value: 'NL', label: 'Newfoundland and Labrador' },
  { value: 'NS', label: 'Nova Scotia' },
  { value: 'NT', label: 'Northwest Territories' },
  { value: 'NU', label: 'Nunavut' },
  { value: 'ON', label: 'Ontario' },
  { value: 'PE', label: 'Prince Edward Island' },
  { value: 'QC', label: 'Quebec' },
  { value: 'SK', label: 'Saskatchewan' },
  { value: 'YT', label: 'Yukon' },
];

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

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
    province: '',
    legallyEntitledCanada: '' as '' | 'yes' | 'no',
    comfortableRemote: '' as '' | 'yes' | 'no',
  });

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim()) e.lastName = 'Required';
    if (!form.email.trim()) e.email = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Invalid email';
    if (!form.phone.trim()) e.phone = 'Required';
    if (!form.city.trim()) e.city = 'Required';
    if (!form.province) e.province = 'Required';
    if (!form.legallyEntitledCanada) e.legallyEntitledCanada = 'Required';
    if (!form.comfortableRemote) e.comfortableRemote = 'Required';
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
          currentRole: '',
          backgroundAreas: [],
          salesExperience: '',
          somethingAboutYourself: '',
          legallyEntitledCanada: form.legallyEntitledCanada as 'yes' | 'no',
          province: form.province,
          comfortableVirtualEnvironment: form.comfortableRemote as 'yes' | 'no',
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
            new Set([
              ...(created.adminData?.tags || []),
              'instantly_checkin',
              ...(form.legallyEntitledCanada === 'no' ? ['not_eligible_canada'] : []),
            ]),
          ),
          nextStep:
            form.legallyEntitledCanada === 'no'
              ? 'Not eligible — not legally entitled to work in Canada'
              : 'Awaiting shortlist / AO Hub invite',
          questionnaireDisqualified:
            form.legallyEntitledCanada === 'no'
              ? {
                  at: now,
                  questionKey: 'legallyEntitledCanada',
                  reason: 'Not legally entitled to work in Canada.',
                }
              : created.adminData?.questionnaireDisqualified || null,
        },
      });
      await notifyCheckInStaff(created.id);
      navigate('/thank-you', {
        state: {
          fromCheckin: true,
          notEligibleCanada: form.legallyEntitledCanada === 'no',
        },
      });
    } catch (err) {
      console.error(err);
      if (err instanceof DuplicateApplicationError) {
        setErrors({ _form: err.message });
      } else {
        const msg =
          err && typeof err === 'object' && 'message' in err
            ? String((err as { message?: string }).message || '')
            : err instanceof Error
              ? err.message
              : '';
        setErrors({
          _form: msg
            ? `Could not save: ${msg}`
            : 'There was an issue saving. Please try again (or open this page in a private window if you are logged into staff).',
        });
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
            alt="AO Paz Globelife"
            className="mx-auto h-auto w-full max-w-md object-contain"
            onError={(ev) => {
              (ev.target as HTMLImageElement).style.display = 'none';
            }}
          />
        </div>

        <h2 className="mb-2 w-full text-2xl font-bold text-gray-900">Check in</h2>
        <p className="mb-1 text-sm font-medium text-[#005EB8]">AO Paz Globelife</p>
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
            label="City"
            value={form.city}
            onChange={(ev) => setForm({ ...form, city: ev.target.value })}
            error={errors.city}
            required
          />
          <Select
            label="Province / Territory"
            value={form.province}
            onChange={(ev) => setForm({ ...form, province: ev.target.value })}
            options={PROVINCE_OPTIONS}
            error={errors.province}
            required
          />
          <Select
            label="Are you legally entitled to work in Canada?"
            value={form.legallyEntitledCanada}
            onChange={(ev) =>
              setForm({ ...form, legallyEntitledCanada: ev.target.value as 'yes' | 'no' })
            }
            options={YES_NO}
            error={errors.legallyEntitledCanada}
            required
          />
          <Select
            label="Are you comfortable working in a 100% remote environment (work from home)?"
            value={form.comfortableRemote}
            onChange={(ev) =>
              setForm({ ...form, comfortableRemote: ev.target.value as 'yes' | 'no' })
            }
            options={YES_NO}
            error={errors.comfortableRemote}
            required
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
