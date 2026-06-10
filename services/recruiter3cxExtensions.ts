/**
 * Reference 3CX extension map — keep in sync with supabase/functions/_shared/recruiter3cxExtensions.ts
 */
export type Recruiter3cxExtensionRow = {
  name: string;
  email: string;
  extension: string;
};

export const RECRUITER_3CX_EXTENSIONS: Recruiter3cxExtensionRow[] = [
  { name: 'Ali Shah', email: 'ali@globelife-paz.com', extension: '9991' },
  { name: 'Alex Paz', email: 'alex@globelife-paz.com', extension: '5201' },
  { name: 'Reg Bentajado', email: 'reginald_bentajado@globelife-paz.com', extension: '5208' },
  { name: 'HR & Licensing', email: 'hr.licensing@globelife-paz.com', extension: '5846' },
  { name: 'Akram Mirahmadi', email: 'akram@globelife-paz.com', extension: '5303' },
  { name: 'Walid Elshahed', email: 'walid@globelife-paz.com', extension: '5789' },
  { name: 'Nicolas Demers', email: 'nicolas_demers@globelife-paz.com', extension: '5522' },
  { name: 'Nita Nath', email: 'nita_nath@globelife-paz.com', extension: '5835' },
  { name: 'Nita Nath', email: 'nita@globelife-paz.com', extension: '5835' },
  { name: 'Raman Kumar', email: 'raman@globelife-paz.com', extension: '5908' },
  { name: 'Devanshi Bodiwala', email: 'devanshi@globelife-paz.com', extension: '5912' },
  { name: 'Emilio Reyes', email: 'emilio@globelife-paz.com', extension: '5925' },
  { name: 'Gamar Baghirli', email: 'gamar_baghirli@globelife-paz.com', extension: '5933' },
  { name: 'Hassaan Khalid', email: 'hasaan_khalid@globelife-paz.com', extension: '5943' },
  { name: 'Jonalyn Manuel', email: 'jonalyn_manuel@globelife-paz.com', extension: '5942' },
];

export function referenceExtensionForEmail(email: string | null | undefined): string | null {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  const row = RECRUITER_3CX_EXTENSIONS.find((r) => r.email.trim().toLowerCase() === normalized);
  return row?.extension?.trim() || null;
}
