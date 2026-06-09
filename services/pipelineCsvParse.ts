export type ParsedHrLeadRow = {
  rowNumber: number;
  leadAge: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  raw: Record<string, string>;
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[_-]+/g, ' ');
}

function pickField(row: Record<string, string>, aliases: string[]): string {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const hit = entries.find(([key]) => normalizeHeader(key) === normalizedAlias);
    if (hit && String(hit[1] || '').trim()) return String(hit[1]).trim();
  }
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const hit = entries.find(([key]) => normalizeHeader(key).includes(normalizedAlias));
    if (hit && String(hit[1] || '').trim()) return String(hit[1]).trim();
  }
  return '';
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out.map((cell) => cell.trim());
}

export function parseHrLeadCsv(text: string): { headers: string[]; rows: ParsedHrLeadRow[]; errors: string[] } {
  const errors: string[] = [];
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    return { headers: [], rows: [], errors: ['CSV file is empty.'] };
  }

  const headers = parseCsvLine(lines[0]);
  if (!headers.length) {
    return { headers: [], rows: [], errors: ['CSV header row is missing.'] };
  }

  const rows: ParsedHrLeadRow[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const cells = parseCsvLine(lines[index]);
    if (!cells.some((cell) => String(cell || '').trim())) continue;
    const record: Record<string, string> = {};
    headers.forEach((header, cellIndex) => {
      record[header] = cells[cellIndex] ?? '';
    });

    const fullName = pickField(record, ['name', 'full name', 'candidate name', 'lead name']);
    const email = pickField(record, ['email', 'email address', 'e mail']).toLowerCase() || null;
    const phone = pickField(record, ['phone number', 'phone', 'mobile', 'cell']) || null;
    const leadAge = pickField(record, ['lead age', 'team', 'source', 'channel']) || null;

    if (!fullName && !email && !phone) {
      errors.push(`Row ${index + 1}: missing name, email, and phone.`);
      continue;
    }

    rows.push({
      rowNumber: index + 1,
      leadAge,
      fullName: fullName || email || phone || 'Unknown Candidate',
      email,
      phone,
      raw: record,
    });
  }

  if (!rows.length && !errors.length) {
    errors.push('No data rows found after the header.');
  }

  return { headers, rows, errors };
}
