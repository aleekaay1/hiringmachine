import React from 'react';
import { Briefcase, ExternalLink, FileText, GraduationCap, MapPin, Sparkles } from 'lucide-react';
import {
  getPipelineResumeOpenInNewTabUrl,
  readPipelineCandidateEmail,
  readPipelineCandidateProfile,
  readPipelineCandidatePhone,
  type PipelineCandidate,
  type PipelineResume,
} from '../../services/pipelineService';

export type CandidateResumeDetailsTone = {
  subtle: string;
  panelTitle: string;
  panelMuted: string;
  panelLabel: string;
  actionButton: string;
};

type CandidateResumeDetailsCardProps = {
  candidate: PipelineCandidate;
  resumes: PipelineResume[];
  tone: CandidateResumeDetailsTone;
};

function DetailItem({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string | null | undefined;
  tone: CandidateResumeDetailsTone;
}) {
  const text = String(value || '').trim();
  if (!text) return null;
  return (
    <div className={`rounded-xl border p-3 ${tone.subtle}`}>
      <div className="flex items-start gap-2">
        <Icon size={14} className={`mt-0.5 shrink-0 ${tone.panelLabel}`} />
        <div className="min-w-0">
          <p className={`text-[10px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>{label}</p>
          <p className={`mt-0.5 text-sm leading-snug ${tone.panelTitle}`}>{text}</p>
        </div>
      </div>
    </div>
  );
}

const CandidateResumeDetailsCard: React.FC<CandidateResumeDetailsCardProps> = ({ candidate, resumes, tone }) => {
  const profile = readPipelineCandidateProfile(candidate);
  const phoneInfo = readPipelineCandidatePhone(candidate);
  const emailInfo = readPipelineCandidateEmail(candidate);
  const metadata = candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {};
  const sourceFile = String((metadata as Record<string, unknown>).original_file_name || '').trim();
  const hasProfile =
    Boolean(profile.current_title) ||
    Boolean(profile.location) ||
    Boolean(profile.total_experience_years) ||
    Boolean(profile.education_highest) ||
    Boolean(profile.skills_summary) ||
    Boolean(profile.work_summary);

  return (
    <section className={`rounded-2xl border p-4 ${tone.subtle}`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${tone.panelLabel}`}>Resume profile</p>
          <p className={`text-xs ${tone.panelMuted}`}>Structured details extracted from the uploaded resume</p>
        </div>
        {sourceFile && (
          <span className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium ${tone.actionButton}`}>
            <FileText size={11} />
            <span className="truncate">{sourceFile}</span>
          </span>
        )}
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <DetailItem icon={Briefcase} label="Current title" value={profile.current_title} tone={tone} />
        <DetailItem icon={MapPin} label="Location" value={profile.location} tone={tone} />
        <DetailItem icon={Sparkles} label="Experience" value={profile.total_experience_years} tone={tone} />
        <DetailItem icon={GraduationCap} label="Education" value={profile.education_highest} tone={tone} />
      </div>

      {profile.skills_summary && (
        <div className={`mb-3 rounded-xl border p-3 ${tone.subtle}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Skills</p>
          <p className={`mt-1 text-sm leading-relaxed ${tone.panelMuted}`}>{profile.skills_summary}</p>
        </div>
      )}

      {profile.work_summary && (
        <div className={`mb-3 rounded-xl border p-3 ${tone.subtle}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wide ${tone.panelLabel}`}>Work summary</p>
          <p className={`mt-1 whitespace-pre-wrap text-sm leading-relaxed ${tone.panelMuted}`}>{profile.work_summary}</p>
        </div>
      )}

      {!hasProfile && (
        <p className={`rounded-xl border border-dashed px-3 py-4 text-center text-xs ${tone.panelMuted}`}>
          No structured resume details yet. Upload processing may still be running, or OCR could not extract a profile.
        </p>
      )}

      <div className={`flex flex-wrap items-center gap-3 border-t pt-3 text-xs ${tone.panelMuted}`}>
        {emailInfo.effectiveEmail && <span>{emailInfo.effectiveEmail}</span>}
        {emailInfo.originalExtractedEmail && emailInfo.originalExtractedEmail !== emailInfo.effectiveEmail && (
          <span className={tone.panelLabel}>OCR email: {emailInfo.originalExtractedEmail}</span>
        )}
        {phoneInfo.effectivePhone && <span>{phoneInfo.effectivePhone}</span>}
        {phoneInfo.originalExtractedPhone && phoneInfo.originalExtractedPhone !== phoneInfo.effectivePhone && (
          <span className={tone.panelLabel}>OCR phone: {phoneInfo.originalExtractedPhone}</span>
        )}
        {candidate.source && <span className={tone.panelLabel}>Source: {candidate.source}</span>}
      </div>

      {resumes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {resumes.slice(0, 3).map((resume) => (
            <a
              key={resume.id}
              href={getPipelineResumeOpenInNewTabUrl(resume) || '#'}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${tone.actionButton}`}
            >
              <ExternalLink size={12} />
              {resume.original_filename}
            </a>
          ))}
        </div>
      )}
    </section>
  );
};

export default CandidateResumeDetailsCard;
