import { supabase } from './supabaseClient';
import { torontoYmdFromDate } from './webinarGeekDates';

const TABLE = 'user_dashboard_day_notes';
const LS_PREFIX = 'pohiring_dashboard_note_v1';

function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205') return true;
  const m = error.message || '';
  return /user_dashboard_day_notes/i.test(m) && /schema cache|does not exist/i.test(m);
}

function localKey(userId: string, noteDate: string): string {
  return `${LS_PREFIX}:${userId}:${noteDate}`;
}

export function todayNoteDateYmd(): string {
  return torontoYmdFromDate();
}

export async function loadUserDashboardDayNote(userId: string, noteDate = todayNoteDateYmd()): Promise<{
  content: string;
  source: 'database' | 'local' | 'empty';
  tableMissing: boolean;
}> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('content')
    .eq('user_id', userId)
    .eq('note_date', noteDate)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      if (typeof window !== 'undefined') {
        const stored = window.localStorage.getItem(localKey(userId, noteDate));
        return { content: stored || '', source: stored ? 'local' : 'empty', tableMissing: true };
      }
      return { content: '', source: 'empty', tableMissing: true };
    }
    throw new Error(error.message);
  }

  if (data && typeof data.content === 'string') {
    return { content: data.content, source: 'database', tableMissing: false };
  }

  return { content: '', source: 'empty', tableMissing: false };
}

export async function saveUserDashboardDayNote(
  userId: string,
  content: string,
  noteDate = todayNoteDateYmd(),
): Promise<{ ok: boolean; tableMissing: boolean; error: string | null }> {
  const trimmed = String(content || '');
  const now = new Date().toISOString();
  const row = {
    user_id: userId,
    note_date: noteDate,
    content: trimmed,
    updated_at: now,
  };

  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'user_id,note_date' });

  if (error) {
    if (isMissingTableError(error)) {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(localKey(userId, noteDate), trimmed);
      }
      return { ok: true, tableMissing: true, error: null };
    }
    return { ok: false, tableMissing: false, error: error.message };
  }

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(localKey(userId, noteDate), trimmed);
  }
  return { ok: true, tableMissing: false, error: null };
}
