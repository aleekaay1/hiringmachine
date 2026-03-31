import { jsPDF } from 'jspdf';
import type { Candidate } from '../types';
import { getAssessmentSummary } from './assessmentSummary';

type LineItem = { label: string; value: string };

const toYesNoMaybe = (v: unknown): string => {
  if (v === 'yes') return 'Yes';
  if (v === 'no') return 'No';
  if (v === 'maybe') return 'Maybe';
  if (v == null) return 'N/A';
  return String(v);
};

const safeText = (v: unknown): string => {
  const s = (v ?? '').toString().trim();
  return s ? s : 'N/A';
};

export function downloadCandidateReportPdf(candidate: Candidate) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const page = {
    w: doc.internal.pageSize.getWidth(),
    h: doc.internal.pageSize.getHeight(),
    margin: 48,
  };
  const maxWidth = page.w - page.margin * 2;

  let y = page.margin;
  const newPageIfNeeded = (needed: number) => {
    if (y + needed <= page.h - page.margin) return;
    doc.addPage();
    y = page.margin;
  };

  const addHeading = (text: string) => {
    newPageIfNeeded(32);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(text, page.margin, y);
    y += 18;
    doc.setDrawColor(220);
    doc.line(page.margin, y, page.w - page.margin, y);
    y += 14;
  };

  const addTextBlock = (text: string, opts?: { bold?: boolean }) => {
    const fontSize = 11;
    doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal');
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, maxWidth);
    const lineHeight = 14;
    newPageIfNeeded(lines.length * lineHeight + 6);
    doc.text(lines, page.margin, y);
    y += lines.length * lineHeight + 6;
  };

  const addKeyValues = (items: LineItem[]) => {
    for (const item of items) {
      addTextBlock(`${item.label}: ${item.value}`);
    }
  };

  // Title + score
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  const title = `Candidate Report`;
  doc.text(title, page.margin, y);
  y += 22;

  const scoreValue = candidate.score != null ? String(candidate.score) : 'N/A';
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(`Score: ${scoreValue}`, page.margin, y);
  y += 18;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(
    `Generated: ${new Date().toLocaleString()}  •  Candidate ID: ${candidate.id}`,
    page.margin,
    y,
  );
  doc.setTextColor(0);
  y += 20;

  // 1) Basic info
  addHeading('1) Candidate information');
  addKeyValues([
    { label: 'Name', value: `${safeText(candidate.firstName)} ${safeText(candidate.lastName)}`.trim() },
    { label: 'Email', value: safeText(candidate.email) },
    { label: 'Phone', value: safeText(candidate.phone) },
  ]);

  // 2) Exit questionnaire (plus legal entitlement from initial form)
  addHeading('2) Post Live Career Overview Exit Questionnaire');

  const legalCanada = (candidate.applicantQuestionnaire as any)?.legallyEntitledCanada;
  addTextBlock(`Legally entitled to work in Canada: ${toYesNoMaybe(legalCanada)}`, { bold: true });

  const eq = candidate.exitQuestionnaire as any;
  if (!eq) {
    addTextBlock('No exit questionnaire submitted.', { bold: false });
  } else {
    const qas: LineItem[] = [
      {
        label: 'What stood out to you most about our career opportunity?',
        value: safeText(eq.whatStoodOut),
      },
      {
        label: 'Why do you feel you would be a good fit for our organization?',
        value: safeText(eq.whyGoodFit),
      },
      {
        label:
          'If you were offered an opportunity to join our company, would you be prepared to make the financial investment to obtain your license [Tuition $348]?',
        value: toYesNoMaybe(eq.financialInvestmentLicense),
      },
      {
        label: 'Are you legally entitled to work in Canada on a FULL-TIME BASIS?',
        value: toYesNoMaybe(eq.legallyEntitledCanadaFullTime),
      },
      {
        label: 'Are you comfortable working in a 100% virtual environment?',
        value: toYesNoMaybe(eq.comfortableVirtualEnvironment),
      },
      {
        label:
          'If we welcome you to our team, would you be excited to join our lively off-site social functions?',
        value: toYesNoMaybe(eq.excitedOffSiteSocial),
      },
      {
        label: 'Which career path are you most interested in?',
        value: safeText(eq.positionInterest),
      },
      {
        label: 'Contact permission',
        value: toYesNoMaybe(eq.contactPermission),
      },
      {
        label: 'Background check willingness',
        value: toYesNoMaybe((candidate.applicantQuestionnaire as any)?.backgroundCheckWilling),
      },
      {
        label: 'What questions, if any, do you have about the career opportunity?',
        value: safeText(eq.questionsAboutOpportunity),
      },
    ];

    for (const { label, value } of qas) {
      addTextBlock(label, { bold: true });
      addTextBlock(value);
    }
  }

  // 3) Assessment summary
  addHeading('3) Assessment summary');
  if (!candidate.assessment) {
    addTextBlock('No assessment submitted.');
  } else {
    const summaryParagraphs = getAssessmentSummary(candidate.assessment);
    if (!summaryParagraphs.length) {
      addTextBlock('No summary available.');
    } else {
      for (const p of summaryParagraphs) addTextBlock(p);
    }
  }

  const fileNameSafe = `${(candidate.firstName || 'candidate')}_${(candidate.lastName || 'report')}`
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/_+/g, '_');
  doc.save(`${fileNameSafe}_report.pdf`);
}

