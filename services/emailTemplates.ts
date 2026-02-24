/** Merge fields for candidate data in email templates */
export const EMAIL_MERGE_FIELDS = ['firstName', 'lastName', 'email', 'phone'] as const;
export type EmailMergeField = typeof EMAIL_MERGE_FIELDS[number];

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
}

/** Placeholder templates – replace bodyHtml with your own HTML. Use {{firstName}}, {{lastName}}, {{email}}, {{phone}}. */
export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'template1',
    name: 'Template 1',
    subject: 'Next steps – Paz Organization / Globe Life AIL',
    bodyHtml: `
      <p>Hi {{firstName}},</p>
      <p>Thank you for your interest in our career opportunity.</p>
      <p>We will be in touch with next steps soon.</p>
      <p>Best regards,<br/>Talent Acquisition<br/>Globe Life – Paz Organization</p>
    `.trim(),
  },
  {
    id: 'template2',
    name: 'Template 2',
    subject: 'Your application – Paz Organization',
    bodyHtml: `
      <p>Hi {{firstName}},</p>
      <p>We have received your application and appreciate your time.</p>
      <p>A team member will contact you to confirm next steps.</p>
      <p>Best regards,<br/>Talent Acquisition<br/>Globe Life – Paz Organization</p>
    `.trim(),
  },
  {
    id: 'template3',
    name: 'Template 3',
    subject: 'Career opportunity – follow-up',
    bodyHtml: `
      <p>Hi {{firstName}},</p>
      <p>Following up on your interest in joining our team.</p>
      <p>Please reply to this email or call us if you have any questions.</p>
      <p>Best regards,<br/>Talent Acquisition<br/>Globe Life – Paz Organization</p>
    `.trim(),
  },
];

export function mergeTemplate(
  subject: string,
  bodyHtml: string,
  candidate: { firstName: string; lastName: string; email: string; phone: string }
): { subject: string; bodyHtml: string } {
  const map: Record<string, string> = {
    '{{firstName}}': candidate.firstName || '',
    '{{lastName}}': candidate.lastName || '',
    '{{email}}': candidate.email || '',
    '{{phone}}': candidate.phone || '',
  };
  let sub = subject;
  let body = bodyHtml;
  for (const [key, value] of Object.entries(map)) {
    sub = sub.split(key).join(value);
    body = body.split(key).join(value);
  }
  return { subject: sub, bodyHtml: body };
}
