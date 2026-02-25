import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { Button, Input } from '../components/UI';
import { createCandidate, saveCandidate, getCandidateByEmail, uploadResume } from '../services/storageService';
import type { ApplicantQuestionnaire } from '../types';
import { RECEPTION_BACKGROUND_AREAS, DEFAULT_ADMIN_DATA } from '../types';
import QRCode from 'react-qr-code';

const RECEPTION_STORAGE_KEY = 'reception_candidate_id';

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
  const [postInterviewUnlocked, setPostInterviewUnlocked] = useState(false);
  const [submittingPre, setSubmittingPre] = useState(false);
  const [submittingPost, setSubmittingPost] = useState(false);
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

  const [postForm, setPostForm] = useState({
    interviewCompleted: null as boolean | null,
    consent: null as boolean | null,
    ceoInvite: null as 'yes' | 'no' | 'declined' | null,
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
          setPostInterviewUnlocked(!!c.postInterview);
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
          if (c.postInterview) {
            setPostForm({
              interviewCompleted: c.postInterview.interviewCompleted,
              consent: c.postInterview.consent,
              ceoInvite: c.postInterview.ceoInvite,
            });
          }
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
        setPostInterviewUnlocked(false);
        return;
      }
      setCandidate(c);
      const q = c.applicantQuestionnaire as ApplicantQuestionnaire | undefined;
      if (q && q.occupation) {
        setPreSubmitted(true);
        setPostInterviewUnlocked(!!c.postInterview);
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
        if (c.postInterview) {
          setPostForm({
            interviewCompleted: c.postInterview.interviewCompleted,
            consent: c.postInterview.consent,
            ceoInvite: c.postInterview.ceoInvite,
          });
        }
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
    if (!preForm.legallyEntitledCanada) e.legallyEntitledCanada = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleResumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setResumeFiles(files);
  };

  const validatePost = (): boolean => {
    const e: Record<string, string> = {};
    if (postForm.interviewCompleted === null) e.interviewCompleted = 'Required';
    if (postForm.consent === null) e.consent = 'Required';
    if (postForm.ceoInvite === null) e.ceoInvite = 'Required';
    setErrors((prev) => ({ ...prev, ...e }));
    return Object.keys(e).length === 0;
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
    } catch (err) {
      console.error(err);
      alert('There was an issue saving. Please try again.');
    } finally {
      setSubmittingPre(false);
    }
  };

  const handlePostSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validatePost() || !candidate) return;
    try {
      setSubmittingPost(true);
      await saveCandidate({
        ...candidate,
        status: 'interview_complete',
        postInterview: {
          interviewCompleted: postForm.interviewCompleted!,
          consent: postForm.consent!,
          ceoInvite: postForm.ceoInvite!,
        },
      });
      sessionStorage.removeItem(RECEPTION_STORAGE_KEY);
      navigate('/thank-you');
    } catch (err) {
      console.error(err);
      alert('There was an issue saving. Please try again.');
    } finally {
      setSubmittingPost(false);
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
      <div className="flex-grow flex flex-col p-4 sm:p-6 max-w-lg mx-auto w-full pb-24">
        <div className="flex justify-center mb-4">
          <img src="/header.PNG" alt="Globe Life AIL Division" className="w-full max-w-md h-auto object-contain" onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
          }} />
        </div>

        <p className="text-sm text-gray-600 mb-4">
          Already started? Enter your email to load your form.
        </p>
        <div className="flex items-center gap-2 mb-6">
          <input
            type="email"
            placeholder="you@example.com"
            value={loadEmail}
            onChange={(e) => setLoadEmail(e.target.value)}
            className="flex-1 min-h-[48px] px-4 py-3 rounded-lg border border-gray-300 focus:ring-[#005EB8] focus:outline-none focus:ring-2 transition-all bg-white"
          />
          <button
            type="button"
            onClick={handleLoadByEmail}
            className="min-h-[48px] px-4 py-3 rounded-lg font-semibold bg-[#005EB8] text-white hover:bg-[#004c94] transition-all whitespace-nowrap text-sm"
          >
            Load my form
          </button>
        </div>
        {loadLookupError && <p className="text-sm text-amber-600 mb-4">{loadLookupError}</p>}

        {/* Post-Interview Completion Status & Assessment Access */}
        {candidate && candidate.postInterview && candidate.postInterview.ceoInvite === 'yes' && (
          <div className="mb-6 rounded-lg border border-purple-200 bg-purple-50 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-purple-600 flex items-center justify-center">
                <span className="text-white text-sm font-bold">✓</span>
              </div>
              <div className="flex-grow">
                <h3 className="font-bold text-purple-900 mb-1">Post-Interview Form Completed</h3>
                <p className="text-sm text-purple-700 mb-3">
                  Thank you! You have completed the post-interview form and were invited to the Career Overview Session.
                </p>
                
                {candidate.assessment || candidate.status === 'assessment_complete' ? (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="font-semibold text-green-800 mb-1">✓ Assessment Completed</p>
                    <p className="text-sm text-green-700">
                      You have already completed the Leadership & Career Assessment. Our team will review your responses and contact you regarding next steps.
                    </p>
                    <Button
                      variant="outline"
                      onClick={() => navigate('/thank-you')}
                      className="mt-3"
                    >
                      View Thank You Page
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-purple-800 mb-4">
                      Next Step: Complete the Leadership & Career Assessment
                    </p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-white p-4 rounded-lg border border-purple-200">
                        <p className="text-xs font-semibold text-gray-700 mb-2">Scan this QR code on another device:</p>
                        <div className="flex justify-center mb-2">
                          <div className="bg-white p-2 rounded border">
                            <QRCode 
                              value={`${typeof window !== 'undefined' ? window.location.origin : ''}/assessment-room/${candidate.id}`}
                              size={120}
                            />
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-500 text-center break-all">
                          {typeof window !== 'undefined' ? window.location.origin : ''}/assessment-room/{candidate.id}
                        </p>
                      </div>
                      
                      <div className="flex flex-col justify-center">
                        <Button
                          fullWidth
                          onClick={() => navigate(`/assessment-room/${candidate.id}`)}
                          className="mb-2"
                        >
                          Go to Assessment Form
                        </Button>
                        <p className="text-xs text-gray-600 text-center">
                          Or click the button above to start the assessment now
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Show message if post-interview completed but not invited */}
        {candidate && candidate.postInterview && candidate.postInterview.ceoInvite !== 'yes' && (
          <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4">
            <p className="font-medium text-green-800 mb-1">Post-Interview Form Completed</p>
            <p className="text-sm text-green-700">
              Thank you for completing the post-interview form. Our team will review your application and contact you regarding next steps.
            </p>
          </div>
        )}

        <h2 className="text-2xl font-bold text-gray-900 mb-2">Reception — Pre-Interview</h2>

        {preSubmitted ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 mb-6">
            <p className="font-medium text-green-800">You have already submitted this section.</p>
            <p className="text-sm text-green-700 mt-1">Please wait for your initial interview. When you are done, fill out the Post-Interview section below.</p>
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
              <label className="block text-sm font-medium text-gray-700 mb-2">Upload your resume (optional)</label>
              <input
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.rtf,.txt,image/*"
                onChange={handleResumeChange}
                className="block w-full text-sm text-gray-700 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[#005EB8] file:text-white hover:file:bg-[#004a93]"
              />
              <p className="text-xs text-gray-500 mt-1">You can attach your resume now. If you have already provided a resume previously, uploading again will add additional files to your record.</p>
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

            <Button type="submit" fullWidth disabled={submittingPre}>{submittingPre ? 'Submitting...' : 'Submit pre-interview'}</Button>
          </form>
        )}

        {/* Only show post-interview section if it hasn't been completed yet */}
        {!candidate?.postInterview && (
          <div className={`border-t border-gray-200 pt-6 ${!preSubmitted ? 'opacity-60 pointer-events-none' : ''}`}>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Post-Interview Confirmation</h2>
            {preSubmitted && !postInterviewUnlocked && (
              <div className="mb-4 p-4 rounded-lg bg-amber-50 border border-amber-200">
                <p className="text-sm text-amber-800">Once you are done with your initial interview, fill out the form below.</p>
                <Button type="button" className="mt-3" onClick={() => setPostInterviewUnlocked(true)}>
                  I have completed my interview
                </Button>
              </div>
            )}

            {preSubmitted && postInterviewUnlocked && (
              <form onSubmit={handlePostSubmit} className="space-y-4">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Has your initial interview been completed by a member of the Management Team? *</p>
                <div className="flex gap-6">
                  <Option name="done" value="yes" label="Yes" checked={postForm.interviewCompleted === true} onChange={() => setPostForm({ ...postForm, interviewCompleted: true })} />
                  <Option name="done" value="no" label="No" checked={postForm.interviewCompleted === false} onChange={() => setPostForm({ ...postForm, interviewCompleted: false })} />
                </div>
                {errors.interviewCompleted && <p className="text-xs text-red-600 mt-1">{errors.interviewCompleted}</p>}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Do you consent to stay in communication for future openings with Globe Life AIL Division? *</p>
                <div className="flex gap-6">
                  <Option name="consent" value="yes" label="Yes" checked={postForm.consent === true} onChange={() => setPostForm({ ...postForm, consent: true })} />
                  <Option name="consent" value="no" label="No" checked={postForm.consent === false} onChange={() => setPostForm({ ...postForm, consent: false })} />
                </div>
                {errors.consent && <p className="text-xs text-red-600 mt-1">{errors.consent}</p>}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Were you invited to attend the Career Overview Session with the CEO? *</p>
                <div className="space-y-2">
                  <Option name="ceo" value="yes" label="Yes" checked={postForm.ceoInvite === 'yes'} onChange={() => setPostForm({ ...postForm, ceoInvite: 'yes' })} />
                  <Option name="ceo" value="no" label="No" checked={postForm.ceoInvite === 'no'} onChange={() => setPostForm({ ...postForm, ceoInvite: 'no' })} />
                  <Option name="ceo" value="declined" label="I elected not to participate" checked={postForm.ceoInvite === 'declined'} onChange={() => setPostForm({ ...postForm, ceoInvite: 'declined' })} />
                </div>
                {errors.ceoInvite && <p className="text-xs text-red-600 mt-1">{errors.ceoInvite}</p>}
              </div>
              <Button type="submit" fullWidth disabled={submittingPost}>{submittingPost ? 'Submitting...' : 'Submit post-interview'}</Button>
              </form>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default InterviewForm;
