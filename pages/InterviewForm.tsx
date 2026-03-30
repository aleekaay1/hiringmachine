import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button, Input } from '../components/UI';
import { createCandidate, saveCandidate, getCandidateByEmail, uploadResume } from '../services/storageService';
import type { ApplicantQuestionnaire } from '../types';
import { RECEPTION_BACKGROUND_AREAS, DEFAULT_ADMIN_DATA } from '../types';

const RECEPTION_STORAGE_KEY = 'reception_candidate_id';
const ZOOM_MEETING_URL = 'https://us02web.zoom.us/j/6478311787';

const OCCUPATION_OPTIONS = [
  { value: 'full-time', label: 'Employed full-time' },
  { value: 'part-time', label: 'Employed part-time' },
  { value: 'self-employed', label: 'Self-employed' },
  { value: 'student', label: 'Student' },
  { value: 'unemployed', label: 'Not currently employed' },
];

const InterviewForm: React.FC = () => {
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<import('../types').Candidate | null>(null);
  const [loadEmail, setLoadEmail] = useState('');
  const [loadLookupError, setLoadLookupError] = useState('');
  const [preSubmitted, setPreSubmitted] = useState(false);
  const [submittingPre, setSubmittingPre] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resumeFiles, setResumeFiles] = useState<File[]>([]);

  const [preForm, setPreForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    city: '',
    occupation: '',
    currentRole: '',
    backgroundAreas: [] as string[],
    backgroundOther: '',
    salesExperience: '',
    somethingAboutYourself: '',
    legallyEntitledCanada: '' as '' | 'yes' | 'no',
  });

  useEffect(() => {
    const storedId = sessionStorage.getItem(RECEPTION_STORAGE_KEY);
    if (!storedId || candidate) return;
    import('../services/storageService').then(({ getCandidateById }) => {
      getCandidateById(storedId).then((c) => {
        if (!c) return;
        setCandidate(c);
        const q = c.applicantQuestionnaire as ApplicantQuestionnaire | undefined;
        if (q && q.occupation) {
          setPreSubmitted(true);
          setPreForm({
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            phone: c.phone,
            city: c.city || '',
            occupation: q.occupation || '',
            currentRole: q.currentRole || '',
            backgroundAreas: q.backgroundAreas || [],
            backgroundOther: q.backgroundOther || '',
            salesExperience: q.salesExperience || '',
            somethingAboutYourself: q.somethingAboutYourself || '',
            legallyEntitledCanada: (q.legallyEntitledCanada as '' | 'yes' | 'no') || '',
          });
        }
      });
    });
  }, [candidate]);

  const handleLoadByEmail = async () => {
    const email = loadEmail.trim().toLowerCase();
    if (!email) {
      setLoadLookupError('Please enter your email.');
      return;
    }
    setLoadLookupError('');
    try {
      const c = await getCandidateByEmail(email);
      if (!c) {
        setLoadLookupError('No record found. Please fill out the form below to start.');
        setCandidate(null);
        setPreSubmitted(false);
        return;
      }
      setCandidate(c);
      const q = c.applicantQuestionnaire as ApplicantQuestionnaire | undefined;
      if (q && q.occupation) {
        setPreSubmitted(true);
        setPreForm({
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          phone: c.phone,
          city: c.city || '',
          occupation: q.occupation || '',
          currentRole: q.currentRole || '',
          backgroundAreas: q.backgroundAreas || [],
          backgroundOther: q.backgroundOther || '',
          salesExperience: q.salesExperience || '',
          somethingAboutYourself: q.somethingAboutYourself || '',
          legallyEntitledCanada: (q.legallyEntitledCanada as '' | 'yes' | 'no') || '',
        });
      } else {
        setPreForm((prev) => ({ ...prev, email: c.email, firstName: c.firstName, lastName: c.lastName, phone: c.phone, city: c.city || '' }));
      }
    } catch (err) {
      console.error(err);
      setLoadLookupError('Could not load your record. Please try again.');
    }
  };

  const toggleBackground = (area: string) => {
    setPreForm((prev) => ({
      ...prev,
      backgroundAreas: prev.backgroundAreas.includes(area)
        ? prev.backgroundAreas.filter((a) => a !== area)
        : [...prev.backgroundAreas, area],
    }));
  };

  const validatePre = (): boolean => {
    const e: Record<string, string> = {};
    if (!preForm.firstName.trim()) e.firstName = 'Required';
    if (!preForm.lastName.trim()) e.lastName = 'Required';
    if (!preForm.email.trim()) e.email = 'Required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(preForm.email)) e.email = 'Invalid email';
    if (!preForm.phone.trim()) e.phone = 'Required';
    if (!preForm.city.trim()) e.city = 'Required';
    if (!preForm.occupation) e.occupation = 'Required';
    if (!preForm.backgroundAreas.length) e.backgroundAreas = 'Select at least one';
    if (!preForm.salesExperience.trim()) e.salesExperience = 'Required';
    if (!resumeFiles.length) e.resumeFiles = 'Please upload your resume.';
    if (!preForm.legallyEntitledCanada) e.legallyEntitledCanada = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleResumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setResumeFiles(files);
  };

  const handlePreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validatePre()) return;
    try {
      setSubmittingPre(true);
      const questionnaireBase: ApplicantQuestionnaire = {
        occupation: preForm.occupation,
        currentRole: preForm.currentRole.trim(),
        backgroundAreas: preForm.backgroundAreas,
        backgroundOther: preForm.backgroundOther.trim() || undefined,
        salesExperience: preForm.salesExperience.trim(),
        somethingAboutYourself: preForm.somethingAboutYourself.trim(),
        legallyEntitledCanada: preForm.legallyEntitledCanada as 'yes' | 'no',
        resumeUrls: candidate?.applicantQuestionnaire?.resumeUrls || [],
      };

      const disq =
        preForm.legallyEntitledCanada === 'no'
          ? {
              at: new Date().toISOString(),
              reason: 'Not legally entitled to work in Canada full-time.',
              questionKey: 'legallyEntitledCanada',
            }
          : null;

      const uploadAllResumes = async (baseCandidate: import('../types').Candidate, baseQuestionnaire: ApplicantQuestionnaire) => {
        if (!resumeFiles.length) {
          return baseCandidate;
        }
        const uploadedUrls = await Promise.all(
          resumeFiles.map((file) => uploadResume(baseCandidate.id, file))
        );
        const updatedCandidate = {
          ...baseCandidate,
          applicantQuestionnaire: {
            ...baseQuestionnaire,
            resumeUrls: [...(baseQuestionnaire.resumeUrls || []), ...uploadedUrls],
          },
        };
        await saveCandidate(updatedCandidate);
        setCandidate(updatedCandidate);
        return updatedCandidate;
      };

      if (preForm.legallyEntitledCanada === 'no') {
        if (!disq) return;
        let baseCandidate: import('../types').Candidate;
        if (candidate) {
          baseCandidate = {
            ...candidate,
            applicantQuestionnaire: questionnaireBase,
            adminData: { ...DEFAULT_ADMIN_DATA, ...candidate.adminData, questionnaireDisqualified: disq },
          };
          await saveCandidate(baseCandidate);
        } else {
          const created = await createCandidate({
            firstName: preForm.firstName.trim(),
            lastName: preForm.lastName.trim(),
            email: preForm.email.trim().toLowerCase(),
            phone: preForm.phone.replace(/\D/g, ''),
            city: preForm.city.trim(),
            applicantQuestionnaire: questionnaireBase,
          });
          baseCandidate = {
            ...created,
            adminData: { ...DEFAULT_ADMIN_DATA, questionnaireDisqualified: disq },
          };
          await saveCandidate(baseCandidate);
        }
        await uploadAllResumes(baseCandidate, {
          ...questionnaireBase,
          resumeUrls: questionnaireBase.resumeUrls,
        });
        navigate('/not-eligible', { state: { reason: 'Our roles require full-time work authorization in Canada.' } });
        return;
      }

      let baseCandidate: import('../types').Candidate;
      if (candidate) {
        baseCandidate = { ...candidate, applicantQuestionnaire: questionnaireBase };
        await saveCandidate(baseCandidate);
        setCandidate(baseCandidate);
      } else {
        const created = await createCandidate({
          firstName: preForm.firstName.trim(),
          lastName: preForm.lastName.trim(),
          email: preForm.email.trim().toLowerCase(),
          phone: preForm.phone.replace(/\D/g, ''),
          city: preForm.city.trim(),
          applicantQuestionnaire: questionnaireBase,
        });
        baseCandidate = created;
        setCandidate(created);
        sessionStorage.setItem(RECEPTION_STORAGE_KEY, created.id);
      }
      await uploadAllResumes(baseCandidate, questionnaireBase);
      setResumeFiles([]);
      setPreSubmitted(true);
      sessionStorage.removeItem(RECEPTION_STORAGE_KEY);
    } catch (err) {
      console.error(err);
      alert('There was an issue saving. Please try again.');
    } finally {
      setSubmittingPre(false);
    }
  };

  const Option = ({ name, value, label, checked, onChange }: { name: string; value: string; label: string; checked: boolean; onChange: () => void }) => (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} className="text-[#005EB8]" />
      <span className="text-sm">{label}</span>
    </label>
  );

  return (
    <Layout>
      <div className="flex-grow flex flex-col items-center text-center p-4 sm:p-6 max-w-lg mx-auto w-full pb-24">
        <div className="flex justify-center mb-5 w-full">
          <img src="/header.PNG" alt="Globe Life AIL Division" className="w-full max-w-md h-auto object-contain mx-auto" onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
          }} />
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-2 w-full">Candidate Checkin</h2>

        <p className="text-sm text-gray-600 mb-4 max-w-md mx-auto">
          Already started? Enter your email to load your form.
        </p>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2 mb-6 w-full max-w-md mx-auto">
          <input
            type="email"
            placeholder="you@example.com"
            value={loadEmail}
            onChange={(e) => setLoadEmail(e.target.value)}
            className="flex-1 min-h-[48px] px-4 py-3 rounded-lg border border-gray-300 focus:ring-[#005EB8] focus:outline-none focus:ring-2 transition-all bg-white text-left"
          />
          <button
            type="button"
            onClick={handleLoadByEmail}
            className="min-h-[48px] px-4 py-3 rounded-lg font-semibold bg-[#005EB8] text-white hover:bg-[#004c94] transition-all whitespace-nowrap text-sm shrink-0"
          >
            Load my form
          </button>
        </div>
        {loadLookupError && <p className="text-sm text-amber-600 mb-4 max-w-md mx-auto">{loadLookupError}</p>}

        {preSubmitted ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 mb-6">
            <p className="font-medium text-green-800">Thank you for checking in.</p>
            <p className="text-sm text-green-700 mt-1">
              Use the Zoom link below to join your scheduled Career Overview Session.
            </p>
            <a
              href={ZOOM_MEETING_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex justify-center w-full mt-4 px-4 py-3 rounded-lg font-semibold bg-[#005EB8] text-white hover:bg-[#004c94] transition-all touch-manipulation"
            >
              Join Zoom Meeting
            </a>
          </div>
        ) : (
          <form onSubmit={handlePreSubmit} className="space-y-4 mb-8">
            <div className="grid grid-cols-2 gap-4">
              <Input label="First Name" value={preForm.firstName} onChange={(e) => setPreForm({ ...preForm, firstName: e.target.value })} error={errors.firstName} required />
              <Input label="Last Name" value={preForm.lastName} onChange={(e) => setPreForm({ ...preForm, lastName: e.target.value })} error={errors.lastName} required />
            </div>
            <Input label="Email Address" type="email" value={preForm.email} onChange={(e) => setPreForm({ ...preForm, email: e.target.value })} error={errors.email} required />
            <Input label="Phone Number" type="tel" value={preForm.phone} onChange={(e) => setPreForm({ ...preForm, phone: e.target.value })} error={errors.phone} required />
            <Input label="City / Town of Residence" value={preForm.city} onChange={(e) => setPreForm({ ...preForm, city: e.target.value })} error={errors.city} required />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">What is your current occupation and employment status? *</label>
              <select
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-[#005EB8] focus:ring-2 focus:outline-none"
                value={preForm.occupation}
                onChange={(e) => setPreForm({ ...preForm, occupation: e.target.value })}
              >
                <option value="">Select...</option>
                {OCCUPATION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {errors.occupation && <p className="text-xs text-red-600 mt-1">{errors.occupation}</p>}
            </div>

            <Input label="Current Role / Company (if applicable)" value={preForm.currentRole} onChange={(e) => setPreForm({ ...preForm, currentRole: e.target.value })} />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Which areas best describe your background and skills? (Select all that apply) *</label>
              <div className="space-y-2">
                {RECEPTION_BACKGROUND_AREAS.map((area) => (
                  <label key={area} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={preForm.backgroundAreas.includes(area)} onChange={() => toggleBackground(area)} className="text-[#005EB8]" />
                    <span className="text-sm">{area}</span>
                  </label>
                ))}
              </div>
              {preForm.backgroundAreas.includes('Other') && (
                <Input label="Other (please specify)" value={preForm.backgroundOther} onChange={(e) => setPreForm({ ...preForm, backgroundOther: e.target.value })} className="mt-2" />
              )}
              {errors.backgroundAreas && <p className="text-xs text-red-600 mt-1">{errors.backgroundAreas}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Briefly describe any experience you have in sales, leadership, or generating revenue. *</label>
              <textarea className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-[#005EB8] focus:ring-2 focus:outline-none min-h-[100px]" value={preForm.salesExperience} onChange={(e) => setPreForm({ ...preForm, salesExperience: e.target.value })} />
              {errors.salesExperience && <p className="text-xs text-red-600 mt-1">{errors.salesExperience}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Upload your resume <span className="text-red-500">*</span>
              </label>
              <input
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.rtf,.txt,image/*"
                required
                onChange={handleResumeChange}
                className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[#005EB8] file:text-white hover:file:bg-[#004a93]"
              />
              <p className="text-xs text-gray-500 mt-1">
                If you have already provided a resume previously, uploading again will add additional files to your record.
              </p>
              {errors.resumeFiles && <p className="text-xs text-red-600 mt-1">{errors.resumeFiles}</p>}
              {resumeFiles.length > 0 && (
                <ul className="mt-2 text-xs text-gray-600 space-y-1">
                  {resumeFiles.map((file) => (
                    <li key={file.name}>{file.name}</li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Final checkpoint: Are you legally entitled to work in Canada? *</p>
              <div className="flex gap-6">
                <Option name="legal" value="yes" label="Yes" checked={preForm.legallyEntitledCanada === 'yes'} onChange={() => setPreForm({ ...preForm, legallyEntitledCanada: 'yes' })} />
                <Option name="legal" value="no" label="No" checked={preForm.legallyEntitledCanada === 'no'} onChange={() => setPreForm({ ...preForm, legallyEntitledCanada: 'no' })} />
              </div>
              {errors.legallyEntitledCanada && <p className="text-xs text-red-600 mt-1">{errors.legallyEntitledCanada}</p>}
            </div>

            <Button type="submit" fullWidth disabled={submittingPre}>{submittingPre ? 'Submitting...' : 'Submit'}</Button>
          </form>
        )}
      </div>
    </Layout>
  );
};

export default InterviewForm;
