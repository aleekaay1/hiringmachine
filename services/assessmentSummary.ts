import type { AssessmentData } from '../types';
import { QUESTIONS } from '../types';
import {
  PERSONALITY_LIKERT_OPTIONS,
  PERSONALITY_TRAIT_GROUPS,
  SCENARIO_QUESTIONS,
  EQ_LIKERT_OPTIONS,
  EQ_INTERPRETATION_THRESHOLDS,
} from './assessmentConfig';
import { calculateScore } from './storageService';

// --- Bands (all possible answers are finite: 0-10 for Q1-2, 0-3 for Likert, 0-3 for TrueScale) ---
type Band = 'low' | 'moderate' | 'high';

function competitivenessBand(v: number): Band {
  if (v <= 3) return 'low';
  if (v <= 6) return 'moderate';
  return 'high';
}

function moneyMotivationBand(v: number): Band {
  if (v <= 3) return 'low';
  if (v <= 6) return 'moderate';
  return 'high';
}

function likertAverage(a: AssessmentData): number {
  if (!a.likertResponses) return 0;
  const vals = QUESTIONS.likert
    .map((q) => a.likertResponses?.[q.id])
    .filter((n) => n !== undefined && n !== null) as number[];
  if (vals.length === 0) return 0;
  return vals.reduce((s, n) => s + n, 0) / vals.length;
}

function trueScaleReversedAverage(a: AssessmentData): number {
  if (!a.trueScaleResponses) return 0;
  const vals = QUESTIONS.trueScale
    .map((q) => {
      const v = a.trueScaleResponses?.[q.id];
      return v === undefined || v === null ? undefined : 3 - v;
    })
    .filter((n): n is number => n !== undefined);
  if (vals.length === 0) return 0;
  return vals.reduce((s, n) => s + n, 0) / vals.length;
}

// --- Pre-made narrative building blocks (static, based on bands) ---

const COMPETITIVENESS_PHRASES: Record<Band, string[]> = {
  low: [
    "This candidate reports a lower competitive drive and may prefer collaborative or stable environments over head-to-head competition.",
    "Competitiveness is self-rated on the lower end; they may respond better to team-based or clearly structured goals rather than open competition.",
    "Lower self-reported competitiveness suggests they might need clear targets and a supportive environment to maintain momentum.",
  ],
  moderate: [
    "This candidate shows a balanced competitive drive—willing to compete when needed without requiring constant rivalry.",
    "Moderate competitiveness indicates they can thrive in both collaborative and goal-driven settings.",
    "They report a middle-ground competitive drive, which can suit environments that mix teamwork with individual accountability.",
  ],
  high: [
    "This candidate reports a strong competitive drive and is likely to thrive in target-based and high-stakes environments.",
    "High self-reported competitiveness suggests they are motivated by rankings, wins, and outperforming benchmarks.",
    "They indicate a strong desire to compete and excel, which aligns well with commission and performance-based roles.",
  ],
};

const MONEY_MOTIVATION_PHRASES: Record<Band, string[]> = {
  low: [
    "Income growth is self-rated as a weaker driver; they may be more motivated by stability, purpose, or work-life balance.",
    "Lower money motivation suggests compensation may need to be framed alongside non-financial rewards and meaning.",
    "They report that earnings potential is less central to their motivation; consider discussing total value proposition beyond pay.",
  ],
  moderate: [
    "Money motivation is in the moderate range—they value income as one factor among others such as growth and culture.",
    "They indicate a balanced interest in earnings potential alongside other job factors.",
    "Moderate money motivation fits roles where pay is important but not the sole driver.",
  ],
  high: [
    "This candidate is highly motivated by income growth and is likely to respond well to commission and performance-based pay.",
    "Strong money motivation suggests they are driven by earnings potential and tangible results.",
    "They report high motivation by income growth, which aligns with results-based compensation and upside opportunity.",
  ],
};

const LIKERT_ALIGNMENT_PHRASES: Record<Band, string[]> = {
  low: [
    "Their responses on leadership and performance attitudes show lower alignment with performance-based culture; they may prefer more predictable or supportive structures.",
    "Agreement with performance-driven and leadership statements is on the lower side; fit may depend on role design and onboarding.",
    "They tend to disagree or only partly agree with many performance/leadership items—worth exploring in interview how they view targets and feedback.",
  ],
  moderate: [
    "They show mixed alignment with performance and leadership statements—some strong agreement, some hesitation. Interview can clarify areas of fit.",
    "Moderate agreement across leadership and performance items suggests they can grow into a high-accountability environment with the right support.",
    "Their responses indicate a middle ground on performance culture; they may need clarity on expectations and development path.",
  ],
  high: [
    "Strong agreement with performance-based and leadership statements suggests good alignment with a results-oriented, high-accountability culture.",
    "They consistently agree with items on ownership, feedback, competition, and measurable goals—positive indicators for a sales/leadership track.",
    "High alignment with the leadership and performance statements indicates they are likely comfortable with targets, rejection, and self-direction.",
  ],
};

const TRUE_SCALE_FIT_PHRASES: Record<Band, string[]> = {
  low: [
    "Their answers to the 'fit risk' items (preference for predictability, fixed pay, clear job description, etc.) suggest they may find a highly variable, high-intensity role stressful. Worth probing in interview.",
    "They tend to endorse statements that favour stability, fixed schedules, and clear boundaries—potential mismatch with uncapped commission and flexible intensity.",
    "Lower scores on reversed fit items indicate possible concerns around pressure, variable income, and work-life flexibility; discuss expectations openly.",
  ],
  moderate: [
    "They show a mixed picture on stability vs. variable pay and intensity—some comfort with ambiguity and results-based work, some preference for structure. Interview can clarify.",
    "Moderate responses on the fit-risk items suggest they could adapt to a performance culture with clear communication and support.",
    "They are neither strongly averse nor strongly comfortable with high variability; onboarding and expectation-setting will be important.",
  ],
  high: [
    "They largely reject statements that favour fixed pay, rigid job descriptions, and low pressure—positive signals for a commission-based, high-autonomy role.",
    "High scores on the reversed fit items suggest they are comfortable with variable income, ambiguity, and high-intensity environments.",
    "Their answers indicate low need for predictability and high tolerance for results-driven, flexible work—good fit indicators for sales/leadership.",
  ],
};

const FIT_CATEGORY_CLOSING: Record<string, string[]> = {
  'High Fit': [
    "Overall assessment profile suggests high fit for a performance-based, leadership-oriented role. Recommend moving forward with next steps.",
    "Combined scores and response pattern indicate strong alignment. Consider prioritising for interview or offer.",
    "Profile is consistent with high fit; competitiveness, money motivation, and attitude items support a positive evaluation.",
  ],
  'Review': [
    "Overall profile suggests a review candidate—some strong signals, some areas to probe in interview before deciding.",
    "Mixed indicators; recommend a structured interview to clarify fit and motivation before advancing.",
    "Worth a closer look: some alignment with the role, with a few areas to validate in conversation.",
  ],
  'Not Aligned': [
    "Overall profile suggests lower alignment with a high-performance, variable-pay environment. Consider other roles or a candid conversation about expectations.",
    "Scores and response patterns indicate potential mismatch; discuss their goals and the role demands before proceeding.",
    "Assessment points to possible misalignment; recommend clarifying their motivation and the role structure before next steps.",
  ],
};

function pickPhrase<T>(phrases: T[], seed: number): T {
  const idx = Math.min(Math.floor(seed * phrases.length), phrases.length - 1);
  return phrases[idx];
}

function buildLegacySummary(assessment: AssessmentData): string[] {
  const compBand = competitivenessBand(assessment.competitiveness);
  const moneyBand = moneyMotivationBand(assessment.moneyMotivation);

  const likertAvg = likertAverage(assessment);
  const likertBand: Band = likertAvg < 1.5 ? 'low' : likertAvg < 2.2 ? 'moderate' : 'high';

  const trueRevAvg = trueScaleReversedAverage(assessment);
  const trueBand: Band = trueRevAvg < 1.2 ? 'low' : trueRevAvg < 2.0 ? 'moderate' : 'high';

  const { fitCategory } = calculateScore(assessment);
  const closingKey = fitCategory ?? 'Review';
  const closingPhrases = FIT_CATEGORY_CLOSING[closingKey] ?? FIT_CATEGORY_CLOSING['Review'];

  // Deterministic "seed" from numeric answers so same answers = same summary
  const seed =
    (assessment.competitiveness * 7 +
      assessment.moneyMotivation * 11 +
      likertAvg * 13 +
      trueRevAvg * 17) %
    1;

  const paragraph1 = pickPhrase(COMPETITIVENESS_PHRASES[compBand], seed);
  const paragraph2 = pickPhrase(MONEY_MOTIVATION_PHRASES[moneyBand], seed + 0.33);
  const paragraph3 = pickPhrase(LIKERT_ALIGNMENT_PHRASES[likertBand], seed + 0.66);
  const paragraph4 = pickPhrase(TRUE_SCALE_FIT_PHRASES[trueBand], seed + 0.5);
  const paragraph5 = pickPhrase(closingPhrases, seed + 0.25);

  return [paragraph1, paragraph2, paragraph3, paragraph4, paragraph5];
}

function buildShortEqAssessmentSummary(assessment: AssessmentData): string[] {
  const paragraphs: string[] = [];
  const { fitCategory, eqBand } = calculateScore(assessment) as { fitCategory: string; eqBand?: string };

  if (assessment.eqAnswers) {
    let eqScore = 0;
    Object.values(assessment.eqAnswers).forEach((key) => {
      const opt = EQ_LIKERT_OPTIONS[key];
      if (opt) eqScore += opt.score;
    });
    const band =
      EQ_INTERPRETATION_THRESHOLDS.find(
        (b) => eqScore >= b.min && eqScore <= b.max,
      ) ?? EQ_INTERPRETATION_THRESHOLDS[EQ_INTERPRETATION_THRESHOLDS.length - 1];
    paragraphs.push(
      `Entrepreneurial Quotient (EQ): total score ${eqScore}, band "${band.label}".`,
    );
    if (eqBand) {
      paragraphs.push(`EQ interpretation: ${eqBand}.`);
    }
  }

  const closingKey = fitCategory ?? 'Review';
  const closingPhrases =
    FIT_CATEGORY_CLOSING[closingKey] ?? FIT_CATEGORY_CLOSING['Review'];
  paragraphs.push(closingPhrases[0]);

  return paragraphs;
}

/**
  const paragraphs: string[] = [];

  // Core drivers
  const compBand = competitivenessBand(assessment.competitiveness);
  const moneyBand = moneyMotivationBand(assessment.moneyMotivation);
  const { fitCategory, eqBand } = calculateScore(assessment) as any;

  const coreDrivers: Record<Band, string> = {
    low: 'Self-reported competitiveness is on the lower side; they may prefer collaborative, stable environments over direct competition.',
    moderate:
      'Competitiveness is in the moderate range; they can operate in both collaborative and performance-driven settings.',
    high: 'They report strong competitiveness and are likely comfortable in target-based, performance-oriented environments.',
  };

  const incomeDrivers: Record<Band, string> = {
    low: 'Income growth is a weaker driver; they may be more motivated by stability, purpose, or work-life balance.',
    moderate:
      'Money motivation is moderate; earnings matter, but are balanced with other factors such as growth and culture.',
    high: 'They are highly motivated by income growth and may respond well to commission and performance-based pay.',
  };

  paragraphs.push(coreDrivers[compBand]);
  paragraphs.push(incomeDrivers[moneyBand]);

  // Personality trait groups
  if (assessment.personalityAnswers) {
    const personalityLines: string[] = [];
    Object.entries(PERSONALITY_TRAIT_GROUPS).forEach(([group, ids]) => {
      const scores = ids
        .map((id) => {
          const key = assessment.personalityAnswers![id];
          if (!key) return undefined;
          const opt = PERSONALITY_LIKERT_OPTIONS[key];
          return opt?.score;
        })
        .filter((v): v is number => v != null);
      if (!scores.length) return;
      const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
      let band: Band = 'moderate';
      if (avg >= 3.4) band = 'high';
      else if (avg <= 2.2) band = 'low';
      const label =
        group === 'leadership_and_drive'
          ? 'leadership & drive'
          : group === 'growth_and_self_improvement'
          ? 'growth and self-improvement'
          : group === 'stability_and_security'
          ? 'stability and security orientation'
          : group === 'social_and_helping_orientation'
          ? 'social / helping orientation'
          : group === 'energy_and_activity_level'
          ? 'energy and activity level'
          : 'openness and curiosity';
      if (band === 'high') {
        personalityLines.push(`Strong ${label}.`);
      } else if (band === 'moderate') {
        personalityLines.push(`Moderate ${label}.`);
      } else {
        personalityLines.push(`Lower emphasis on ${label}.`);
      }
    });
    if (personalityLines.length) {
      paragraphs.push(
        `Personality profile summary: ${personalityLines.join(' ')}`,
      );
    }
  }

  // Scenario preferences (pick a few key scenarios)
  if (assessment.scenarioAnswers) {
    const prefs: string[] = [];
    const ans = assessment.scenarioAnswers;
    const q26 = ans[26];
    if (q26) {
      const opt = SCENARIO_QUESTIONS.find((q) => q.id === 26)?.options[q26];
      if (opt) {
        prefs.push(
          `Supervision preference (Q26): "${opt}" – indicating how much direction they prefer.`,
        );
      }
    }
    const q30 = ans[30];
    if (q30) {
      const opt = SCENARIO_QUESTIONS.find((q) => q.id === 30)?.options[q30];
      if (opt) {
        prefs.push(
          `Goal-setting style (Q30): "${opt}" – reveals their planning vs. flexibility bias.`,
        );
      }
    }
    const q34 = ans[34];
    if (q34) {
      const opt = SCENARIO_QUESTIONS.find((q) => q.id === 34)?.options[q34];
      if (opt) {
        prefs.push(
          `Result focus (Q34): "${opt}" – shows whether they prioritize short- or long-term outcomes.`,
        );
      }
    }
    const q40 = ans[40];
    if (q40) {
      const opt = SCENARIO_QUESTIONS.find((q) => q.id === 40)?.options[q40];
      if (opt) {
        prefs.push(
          `Rules vs. flexibility (Q40): "${opt}" – indicates their comfort with strict policy enforcement vs. pragmatic exceptions.`,
        );
      }
    }
    if (prefs.length) {
      paragraphs.push(
        `Scenario & preference snapshot: ${prefs.join(' ')}`,
      );
    }
  }

  // EQ band
  if (assessment.eqAnswers) {
    let eqScore = 0;
    Object.values(assessment.eqAnswers).forEach((key) => {
      const opt = EQ_LIKERT_OPTIONS[key];
      if (opt) eqScore += opt.score;
    });
    const band =
      EQ_INTERPRETATION_THRESHOLDS.find(
        (b) => eqScore >= b.min && eqScore <= b.max,
      ) ?? EQ_INTERPRETATION_THRESHOLDS[EQ_INTERPRETATION_THRESHOLDS.length - 1];
    paragraphs.push(
      `Entrepreneurial Quotient (EQ): total score ${eqScore}, band "${band.label}".`,
    );
  }

  // Overall closing based on fitCategory
  const closingKey = (fitCategory as string) ?? 'Review';
  const closingPhrases =
    FIT_CATEGORY_CLOSING[closingKey] ?? FIT_CATEGORY_CLOSING['Review'];
  paragraphs.push(closingPhrases[0]);

  return paragraphs;
}

/**
 * Generates a psychological summary for the admin based only on assessment answers (no AI).
 * Uses legacy phrases for the old 30-question assessment, and trait-based summary for the new one.
 */
export function getAssessmentSummary(assessment: AssessmentData): string[] {
  const isShortEq =
    assessment.eqAnswers &&
    Object.keys(assessment.eqAnswers).length > 0 &&
    !assessment.personalityAnswers &&
    !assessment.scenarioAnswers &&
    (!assessment.openEndedAnswers || Object.keys(assessment.openEndedAnswers).length === 0);

  if (isShortEq) {
    return buildShortEqAssessmentSummary(assessment);
  }
  if (assessment.personalityAnswers || assessment.scenarioAnswers || assessment.eqAnswers) {
    return buildNewAssessmentSummary(assessment);
  }
  return buildLegacySummary(assessment);
}

