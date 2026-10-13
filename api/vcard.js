const DEFAULT_ADDRESS = '59-700 Third Line, Oakville, ON. L6L 4B1';

function field(query, key) {
  const value = query?.[key];
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? '').replace(/[\r\n]+/g, ' ').trim();
}

function vEscape(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function phone(value) {
  return value.replace(/\s+/g, '');
}

function contentDisposition(name) {
  const clean = (name || 'Contact').replace(/["\\]/g, '').trim() || 'Contact';
  const ascii = clean.replace(/[^\x20-\x7E]/g, '').replace(/[^A-Za-z0-9 ._-]/g, '').trim() || 'Contact';
  return `attachment; filename="${ascii}.vcf"; filename*=UTF-8''${encodeURIComponent(`${clean}.vcf`)}`;
}

export function vcardFromQuery(query) {
  const name = field(query, 'n');
  const email = field(query, 'e');
  if (!name && !email) return null;

  const parts = name.split(/\s+/).filter(Boolean);
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  const first = parts.slice(0, -1).join(' ') || name;
  const title = field(query, 't');
  const org = field(query, 'o');
  const office = phone(field(query, 'p'));
  const direct = phone(field(query, 'd'));
  const ext = field(query, 'x');
  const address = field(query, 'a') || DEFAULT_ADDRESS;
  const website = field(query, 'w');

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${vEscape(name)}`,
    `N:${vEscape(last)};${vEscape(first)};;;`,
  ];
  if (org) lines.push(`ORG:${vEscape(org)}`);
  if (title) lines.push(`TITLE:${vEscape(title)}`);
  if (email) lines.push(`EMAIL;TYPE=WORK:${vEscape(email)}`);
  if (office) lines.push(`TEL;TYPE=WORK,VOICE:${vEscape(office)}`);
  if (direct) lines.push(`TEL;TYPE=CELL,VOICE:${vEscape(direct)}`);
  if (ext) lines.push(`NOTE:Office Ext. ${vEscape(ext)}`);
  if (address === DEFAULT_ADDRESS) {
    lines.push('ADR;TYPE=WORK:;;59-700 Third Line;Oakville;ON;L6L 4B1;Canada');
  } else {
    lines.push(`ADR;TYPE=WORK:;;${vEscape(address)};;;;`);
  }
  if (website) lines.push(`URL:${website.replace(/[\r\n]+/g, '')}`);
  lines.push('END:VCARD');

  return {
    filename: contentDisposition(name || 'Contact'),
    body: `${lines.join('\r\n')}\r\n`,
  };
}

export default function handler(req, res) {
  const card = vcardFromQuery(req.query || {});
  if (!card) {
    res.status(400).setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send('Missing contact name or email');
    return;
  }
  res.status(200);
  res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
  res.setHeader('Content-Disposition', card.filename);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(card.body);
}
