/** Client-side CSV + Excel parsing for bulk email uploads. */

export type SpreadsheetTable = {
  headers: string[];
  rows: string[][];
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function parseCsvText(text: string): SpreadsheetTable {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter((l) => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]).map((h, i) => h || `Column ${i + 1}`);
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    while (cells.length < headers.length) cells.push('');
    return cells.slice(0, headers.length);
  });
  return { headers, rows };
}

function scoreHeader(name: string, kind: 'email' | 'name'): number {
  const n = name.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (kind === 'email') {
    if (n === 'email' || n === 'e mail' || n === 'email address') return 100;
    if (n.includes('email')) return 80;
    if (n.includes('e-mail') || n.includes('mail')) return 60;
    return 0;
  }
  if (n === 'name' || n === 'full name' || n === 'fullname') return 100;
  if (n.includes('full name') || n.includes('first name')) return 90;
  if (n.includes('name') && !n.includes('file') && !n.includes('company')) return 70;
  if (n === 'first' || n === 'lastname' || n === 'last name') return 50;
  return 0;
}

export function guessColumn(headers: string[], kind: 'email' | 'name'): string {
  let best = '';
  let bestScore = 0;
  for (const h of headers) {
    const s = scoreHeader(h, kind);
    if (s > bestScore) {
      bestScore = s;
      best = h;
    }
  }
  return best;
}

export function isLikelyEmail(value: string): boolean {
  const v = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export async function parseSpreadsheetFile(file: File): Promise<SpreadsheetTable> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = await file.text();
    return parseCsvText(text);
  }
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return { headers: [], rows: [] };
    const sheet = wb.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
    }) as string[][];
    if (!matrix.length) return { headers: [], rows: [] };
    const headers = (matrix[0] || []).map((h, i) => String(h || '').trim() || `Column ${i + 1}`);
    const rows = matrix.slice(1).map((row) => {
      const cells = (row || []).map((c) => String(c ?? '').trim());
      while (cells.length < headers.length) cells.push('');
      return cells.slice(0, headers.length);
    }).filter((r) => r.some((c) => c.length > 0));
    return { headers, rows };
  }
  throw new Error('Unsupported file. Upload a .csv or .xlsx file.');
}

export type MappedRecipient = {
  name: string;
  email: string;
  rowIndex: number;
  raw: Record<string, string>;
};

export function mapRecipients(
  table: SpreadsheetTable,
  nameCol: string,
  emailCol: string,
): { recipients: MappedRecipient[]; skipped: number } {
  const nameIdx = table.headers.indexOf(nameCol);
  const emailIdx = table.headers.indexOf(emailCol);
  if (emailIdx < 0) throw new Error('Select an email column');
  const recipients: MappedRecipient[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i];
    const email = String(row[emailIdx] || '').trim().toLowerCase();
    if (!isLikelyEmail(email)) {
      skipped++;
      continue;
    }
    if (seen.has(email)) {
      skipped++;
      continue;
    }
    seen.add(email);
    const name = nameIdx >= 0 ? String(row[nameIdx] || '').trim() : '';
    const raw: Record<string, string> = {};
    table.headers.forEach((h, idx) => {
      raw[h] = String(row[idx] || '');
    });
    recipients.push({ name, email, rowIndex: i + 2, raw });
  }
  return { recipients, skipped };
}
