import React from 'react';
import { Button } from '../UI';
import {
  readPipelineCandidateProfile,
  readPipelineCandidateTextExcerpt,
  updatePipelineCandidateProfile,
  type PipelineCandidate,
  type PipelineCandidateProfile,
} from '../../services/pipelineService';

export type CandidateProfileEditorTone = {
  subtle: string;
  panelTitle: string;
  panelMuted: string;
  panelLabel: string;
  input: string;
  actionButton: string;
};

type CandidateProfileEditorProps = {
  candidate: PipelineCandidate;
  tone: CandidateProfileEditorTone;
  isDark: boolean;
  onSaved: (candidate: PipelineCandidate) => void;
};

function applyProfileToForm(candidate: PipelineCandidate) {
  const profile = readPipelineCandidateProfile(candidate);
  return {
    fullName: candidate.full_name || '',
    email: candidate.email || '',
    phone: candidate.phone || '',
    title: profile.current_title || '',
    location: profile.location || '',
    experience: profile.total_experience_years || '',
    education: profile.education_highest || '',
    skills: profile.skills_summary || '',
    summary: profile.work_summary || '',
  };
}

const CandidateProfileEditor: React.FC<CandidateProfileEditorProps> = ({ candidate, tone, isDark, onSaved }) => {
  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [experience, setExperience] = React.useState('');
  const [education, setEducation] = React.useState('');
  const [skills, setSkills] = React.useState('');
  const [summary, setSummary] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    const next = applyProfileToForm(candidate);
    setFullName(next.fullName);
    setEmail(next.email);
    setPhone(next.phone);
    setTitle(next.title);
    setLocation(next.location);
    setExperience(next.experience);
    setEducation(next.education);
    setSkills(next.skills);
    setSummary(next.summary);
    setMessage(null);
  }, [candidate.id]);

  const ocrExcerpt = readPipelineCandidateTextExcerpt(candidate);

  const saveProfile = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const profile: PipelineCandidateProfile = {
        current_title: title || null,
        location: location || null,
        total_experience_years: experience || null,
        education_highest: education || null,
        skills_summary: skills || null,
        work_summary: summary || null,
      };
      await updatePipelineCandidateProfile({
        candidateId: candidate.id,
        fullName,
        email: email || null,
        phone: phone || null,
        profile,
      });
      const metadata =
        candidate.metadata && typeof candidate.metadata === 'object'
          ? { ...(candidate.metadata as Record<string, unknown>) }
          : {};
      onSaved({
        ...candidate,
        full_name: fullName.trim() || 'Unknown Candidate',
        email: email.trim() || null,
        phone: phone.trim() || null,
        metadata: {
          ...metadata,
          ocr_profile: profile,
          ocr_profile_updated_at: new Date().toISOString(),
        },
      });
      setMessage('Profile saved.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const fieldClass = `mt-1 w-full rounded-lg border px-2 py-1.5 text-xs ${tone.input}`;
  const labelClass = `text-xs ${tone.panelMuted}`;

  return (
    <section className={`rounded-xl border p-3 space-y-2 ${tone.subtle}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className={`text-xs font-semibold uppercase tracking-wide ${tone.panelTitle}`}>Candidate profile (OCR + edit)</h3>
          <p className={`text-[11px] ${tone.panelLabel}`}>
            Review and correct extracted details before calling.
          </p>
        </div>
        <Button
          variant="outline"
          className={`!min-h-0 h-8 text-xs ${isDark ? '!border-white/20 !bg-white/10 !text-slate-100 hover:!bg-white/15' : ''}`}
          onClick={() => void saveProfile()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save profile'}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <label className={labelClass}>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Current title
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Location
          <input value={location} onChange={(e) => setLocation(e.target.value)} className={fieldClass} />
        </label>
        <label className={labelClass}>
          Experience
          <input
            value={experience}
            onChange={(e) => setExperience(e.target.value)}
            placeholder="e.g. 5+ years"
            className={fieldClass}
          />
        </label>
        <label className={`${labelClass} md:col-span-2`}>
          Highest education
          <input value={education} onChange={(e) => setEducation(e.target.value)} className={fieldClass} />
        </label>
        <label className={`${labelClass} md:col-span-3`}>
          Skills summary
          <input value={skills} onChange={(e) => setSkills(e.target.value)} className={fieldClass} />
        </label>
        <label className={`${labelClass} md:col-span-3`}>
          Work summary
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} className={fieldClass} />
        </label>
      </div>

      {ocrExcerpt.trim() && (
        <details className={`rounded-lg border p-2 ${tone.subtle}`}>
          <summary className={`cursor-pointer text-[11px] font-semibold ${tone.panelMuted}`}>Raw OCR excerpt</summary>
          <pre className={`mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] ${tone.panelLabel}`}>{ocrExcerpt.trim()}</pre>
        </details>
      )}

      {message && (
        <p className={`text-[11px] ${message.includes('saved') ? (isDark ? 'text-emerald-200' : 'text-emerald-700') : 'text-red-600'}`}>
          {message}
        </p>
      )}
    </section>
  );
};

export default CandidateProfileEditor;
