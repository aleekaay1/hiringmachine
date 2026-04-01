import {
  Candidate,
  AssessmentData,
  ApplicantQuestionnaire,
  AdminData,
  DEFAULT_ADMIN_DATA,
  PostLiveExitQuestionnaire,
  normalizePipelineStage,
} from '../types';
import {
  PERSONALITY_LIKERT_OPTIONS,
  EQ_LIKERT_OPTIONS,
  EQ_INTERPRETATION_THRESHOLDS,
} from './assessmentConfig';
import { supabase } from './supabaseClient';

const TABLE_NAME = 'candidates';
const RESUMES_BUCKET = 'candidate-resumes';

/** Shown when a new application would duplicate an existing CRM record. */
export const DUPLICATE_APPLICATION_MESSAGE =
  'You have already applied. Please contact HR for information.';

export class DuplicateApplicationError extends Error {
  constructor(message = DUPLICATE_APPLICATION_MESSAGE) {
    super(message);
    this.name = 'DuplicateApplicationError';
  }
}

function normalizeNamePart(s: string): string {
  return (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function namesMatchNormalized(c: Candidate, firstNorm: string, lastNorm: string): boolean {
  return normalizeNamePart(c.firstName) === firstNorm && normalizeNamePart(c.lastName) === lastNorm;
}

/**
 * Detects whether creating a new candidate would duplicate an existing application:
 * - Same email as an existing record (one email = one application), or
 * - Same normalized full name and email as an existing record (explicit pair match), or
 * - Same normalized full name and phone as an existing record with a different email (same person, new email).
 */
export async function findDuplicateApplication(input: {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
}): Promise<Candidate | null> {
  const emailNorm = (input.email || '').trim().toLowerCase();
  const firstNorm = normalizeNamePart(input.firstName);
  const lastNorm = normalizeNamePart(input.lastName);
  const phoneNorm = (input.phone || '').replace(/\D/g, '');

  const byEmail = await getCandidateByEmail(emailNorm);
  if (byEmail) {
    return byEmail;
  }

  if (phoneNorm.length >= 7) {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('*')
      .eq('phone', phoneNorm);
    if (error) {
      console.error('Error checking duplicate by phone', error);
      throw error;
    }
    for (const row of data || []) {
      const c = fromRow(row as CandidateRow);
      if (c.email.trim().toLowerCase() === emailNorm) continue;
      if (namesMatchNormalized(c, firstNorm, lastNorm)) return c;
    }
  }

  return null;
}

// --- Mapping helpers between DB rows and Candidate type ---

type CandidateRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  city: string;
  timestamp: string;
  status: Candidate['status'];
  admin_data: AdminData | null;
  applicant_questionnaire: ApplicantQuestionnaire | null;
  post_interview: Candidate['postInterview'] | null;
  assessment: AssessmentData | null;
  score: number | null;
  fit_category: Candidate['fitCategory'] | null;
  exit_questionnaire: PostLiveExitQuestionnaire | null;
};

const fromRow = (row: CandidateRow): Candidate => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  email: row.email,
  phone: row.phone,
  city: row.city || '',
  timestamp: row.timestamp,
  status: row.status,
  adminData: row.admin_data
    ? {
        ...DEFAULT_ADMIN_DATA,
        ...row.admin_data,
        pipelineStage: normalizePipelineStage(row.admin_data.pipelineStage),
      }
    : undefined,
  applicantQuestionnaire: row.applicant_questionnaire || undefined,
  postInterview: row.post_interview || undefined,
  assessment: row.assessment || undefined,
  score: row.score ?? undefined,
  fitCategory: row.fit_category ?? undefined,
  exitQuestionnaire: row.exit_questionnaire ?? undefined,
});

const toRow = (candidate: Candidate): CandidateRow => ({
  id: candidate.id,
  first_name: candidate.firstName,
  last_name: candidate.lastName,
  email: candidate.email,
  phone: candidate.phone,
  city: candidate.city || '',
  timestamp: candidate.timestamp,
  status: candidate.status,
  admin_data: candidate.adminData ?? null,
  applicant_questionnaire: candidate.applicantQuestionnaire ?? null,
  post_interview: candidate.postInterview ?? null,
  assessment: candidate.assessment ?? null,
  score: candidate.score ?? null,
  fit_category: candidate.fitCategory ?? null,
  exit_questionnaire: candidate.exitQuestionnaire ?? null,
});

// --- Public API used by components (now async + Supabase-backed) ---

export const getCandidates = async (): Promise<Candidate[]> => {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .order('timestamp', { ascending: false });

  if (error) {
    console.error('Error fetching candidates from Supabase', error);
    throw error;
  }

  return (data as CandidateRow[]).map(fromRow);
};

export const getCandidateById = async (id: string): Promise<Candidate | null> => {
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('Error fetching candidate by id from Supabase', error);
    throw error;
  }

  return data ? fromRow(data as CandidateRow) : null;
};

export const getCandidateByEmail = async (email: string): Promise<Candidate | null> => {
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return null;
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .ilike('email', normalized)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('Error fetching candidate by email from Supabase', error);
    throw error;
  }
  return data ? fromRow(data as CandidateRow) : null;
};

export const saveCandidate = async (candidate: Candidate): Promise<void> => {
  const row = toRow(candidate);
  const { data: existing } = await supabase.from(TABLE_NAME).select('id').eq('id', candidate.id).maybeSingle();
  if (existing) {
    const { error } = await supabase.from(TABLE_NAME).update(row).eq('id', candidate.id);
    if (error) {
      console.error('Error updating candidate in Supabase', error);
      throw error;
    }
  } else {
    const { error } = await supabase.from(TABLE_NAME).insert(row);
    if (error) {
      console.error('Error inserting candidate to Supabase', error);
      throw error;
    }
  }
};

export const createCandidate = async (initialData: Partial<Candidate>): Promise<Candidate> => {
  const normalizedEmail = (initialData.email || '').trim().toLowerCase();
  const normalizedPhone = (initialData.phone || '').replace(/\D/g, '');

  const duplicate = await findDuplicateApplication({
    email: normalizedEmail,
    firstName: initialData.firstName || '',
    lastName: initialData.lastName || '',
    phone: normalizedPhone,
  });
  if (duplicate) {
    throw new DuplicateApplicationError();
  }

  const newCandidate: Candidate = {
    id: crypto.randomUUID().split('-')[0].toUpperCase(),
    firstName: initialData.firstName || '',
    lastName: initialData.lastName || '',
    email: normalizedEmail,
    phone: normalizedPhone,
    city: initialData.city || '',
    timestamp: new Date().toISOString(),
    status: 'new',
    applicantQuestionnaire: initialData.applicantQuestionnaire,
    exitQuestionnaire: initialData.exitQuestionnaire,
  };

  const row = toRow(newCandidate);
  const { error } = await supabase.from(TABLE_NAME).insert(row);
  if (error) {
    console.error('Error inserting candidate to Supabase', error);
    throw error;
  }
  return newCandidate;
};

/** Resume upload. Uses Edge Function when available (bypasses Storage RLS). */
export const uploadResume = async (candidateId: string, file: File): Promise<string> => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  const useEdgeFunction = supabaseUrl && anonKey;

  if (useEdgeFunction) {
    const form = new FormData();
    form.set('candidateId', candidateId);
    form.set('file', file);
    const res = await fetch(`${supabaseUrl}/functions/v1/upload-resume`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
      },
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err?.error || res.statusText);
    }
    const { url } = await res.json();
    if (!url) throw new Error('No URL returned');
    return url;
  }

  const path = `${candidateId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const { error } = await supabase.storage.from(RESUMES_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(RESUMES_BUCKET).getPublicUrl(path);
  return data.publicUrl;
};

export const deleteCandidate = async (id: string): Promise<void> => {
  const { error } = await supabase.from(TABLE_NAME).delete().eq('id', id);
  if (error) {
    console.error('Error deleting candidate from Supabase', error);
    throw error;
  }
};

// Auto-scoring logic
export const calculateScore = (assessment: AssessmentData) => {
  // --- New 50-question assessment scoring ---
  if (assessment.personalityAnswers || assessment.eqAnswers) {
    let score = 0;
    let maxScore = 0;

    // Core drivers sliders (1–10 each, max 20)
    score += assessment.competitiveness;
    score += assessment.moneyMotivation;
    maxScore += 20;

    // Personality profile (25 items, 1–4 each)
    if (assessment.personalityAnswers) {
      Object.entries(assessment.personalityAnswers).forEach(([_, key]) => {
        const opt = PERSONALITY_LIKERT_OPTIONS[key];
        if (opt) {
          score += opt.score;
          maxScore += 4;
        }
      });
    }

    // EQ test (10 items, 1–4 each, higher is more entrepreneurial)
    let eqScore = 0;
    if (assessment.eqAnswers) {
      Object.entries(assessment.eqAnswers).forEach(([_, key]) => {
        const opt = EQ_LIKERT_OPTIONS[key];
        if (opt) {
          eqScore += opt.score;
          score += opt.score;
          maxScore += 4;
        }
      });
    }

    const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;

    let fitCategory: 'High Fit' | 'Review' | 'Not Aligned';
    if (percentage >= 80) fitCategory = 'High Fit';
    else if (percentage >= 50) fitCategory = 'Review';
    else fitCategory = 'Not Aligned';

    // Determine EQ interpretation (not stored separately, but useful for admin summary)
    const eqBand =
      EQ_INTERPRETATION_THRESHOLDS.find(
        (band) => eqScore >= band.min && eqScore <= band.max,
      ) ?? EQ_INTERPRETATION_THRESHOLDS[EQ_INTERPRETATION_THRESHOLDS.length - 1];

    return { score, fitCategory, percentage, eqScore, eqBand: eqBand.label };
  }

  // --- Legacy 30-question scoring ---
  let score = 0;
  let maxScore = 0;

  // Q1-2: 1-10 scale (Treat as raw points, max 20)
  score += assessment.competitiveness;
  score += assessment.moneyMotivation;
  maxScore += 20;

  if (assessment.likertResponses) {
    // Q3-20: Likert (0-3) - Positive traits
    // Strongly Agree (3) -> Strongly Disagree (0)
    Object.values(assessment.likertResponses).forEach((val) => {
      score += val;
      maxScore += 3;
    });
  }

  if (assessment.trueScaleResponses) {
    // Q21-30: True Scale (0-3) - Negative traits
    // The input value is 3 (Always True) to 0 (Never True).
    // These are negative traits for a sales role.
    // We want to REVERSE score them for "Fit".
    // If user says "Never True" (0), that's good (score 3).
    // If user says "Always True" (3), that's bad (score 0).
    Object.values(assessment.trueScaleResponses).forEach((val) => {
      score += 3 - val; // Reverse scoring
      maxScore += 3;
    });
  }

  const percentage = (score / maxScore) * 100;
  
  let fitCategory: 'High Fit' | 'Review' | 'Not Aligned';
  if (percentage >= 80) fitCategory = 'High Fit';
  else if (percentage >= 50) fitCategory = 'Review';
  else fitCategory = 'Not Aligned';

  return { score, fitCategory, percentage };
};
