import { supabase } from './supabaseClient';
import { loadUserDashboardDayNote, todayNoteDateYmd } from './userDashboardDayNotes';

const TABLE = 'user_dashboard_sticky_notes';
const LS_PREFIX = 'pohiring_dashboard_sticky_notes_v1';

export type StickyNoteColorKey = 'amber' | 'sky' | 'mint' | 'rose' | 'lavender' | 'peach';

export type DashboardStickyNote = {
  id: string;
  userId: string;
  title: string;
  body: string;
  colorKey: StickyNoteColorKey;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export const STICKY_NOTE_COLOR_KEYS: StickyNoteColorKey[] = [
  'amber',
  'sky',
  'mint',
  'rose',
  'lavender',
  'peach',
];

function isMissingTableError(error: { code?: string; message?: string; details?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === 'PGRST116') return true;
  const m = `${error.message || ''} ${error.details || ''}`;
  if (/404/.test(m) || /not found/i.test(m)) return true;
  return /user_dashboard_sticky_notes/i.test(m) && /schema cache|does not exist|relation/i.test(m);
}

function localKey(userId: string): string {
  return `${LS_PREFIX}:${userId}`;
}

function rowToNote(row: Record<string, unknown>): DashboardStickyNote {
  const color = String(row.color_key ?? 'amber');
  const colorKey = STICKY_NOTE_COLOR_KEYS.includes(color as StickyNoteColorKey)
    ? (color as StickyNoteColorKey)
    : 'amber';
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title ?? ''),
    body: String(row.body ?? ''),
    colorKey,
    sortOrder: Number(row.sort_order ?? 0),
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

function readLocalNotes(userId: string): DashboardStickyNote[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(localKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const o = item as Record<string, unknown>;
        return rowToNote({
          id: o.id,
          user_id: userId,
          title: o.title,
          body: o.body,
          color_key: o.colorKey ?? o.color_key,
          sort_order: o.sortOrder ?? o.sort_order,
          created_at: o.createdAt ?? o.created_at,
          updated_at: o.updatedAt ?? o.updated_at,
        });
      })
      .filter(Boolean) as DashboardStickyNote[];
  } catch {
    return [];
  }
}

function writeLocalNotes(userId: string, notes: DashboardStickyNote[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(localKey(userId), JSON.stringify(notes));
}

function sortNotes(notes: DashboardStickyNote[]): DashboardStickyNote[] {
  return [...notes].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

async function importLegacyDayNoteIfEmpty(userId: string, notes: DashboardStickyNote[]): Promise<DashboardStickyNote[]> {
  if (notes.length > 0) return notes;
  const legacy = await loadUserDashboardDayNote(userId, todayNoteDateYmd());
  const text = legacy.content.trim();
  if (!text) return notes;
  const created = await createUserDashboardStickyNote(userId, {
    title: "Today's reminders",
    body: text,
    colorKey: 'amber',
  });
  return created.ok && created.note ? [created.note] : notes;
}

export async function listUserDashboardStickyNotes(
  userId: string,
  options?: { skipLegacyImport?: boolean },
): Promise<{
  notes: DashboardStickyNote[];
  tableMissing: boolean;
}> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, user_id, title, body, color_key, sort_order, created_at, updated_at')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    if (isMissingTableError(error)) {
      const local = sortNotes(readLocalNotes(userId));
      const withLegacy = options?.skipLegacyImport
        ? local
        : await importLegacyDayNoteIfEmpty(userId, local);
      return { notes: withLegacy, tableMissing: true };
    }
    throw new Error(error.message);
  }

  let notes = sortNotes((data || []).map((row) => rowToNote(row as Record<string, unknown>)));
  if (!options?.skipLegacyImport) {
    notes = await importLegacyDayNoteIfEmpty(userId, notes);
  }
  return { notes, tableMissing: false };
}

function nextSortOrder(notes: DashboardStickyNote[]): number {
  if (notes.length === 0) return 0;
  return Math.max(...notes.map((n) => n.sortOrder)) + 1;
}

async function maxSortOrderForUser(userId: string): Promise<number> {
  let max = -1;
  for (const n of readLocalNotes(userId)) max = Math.max(max, n.sortOrder);
  const { data, error } = await supabase.from(TABLE).select('sort_order').eq('user_id', userId);
  if (!error) {
    for (const row of data || []) {
      max = Math.max(max, Number((row as { sort_order?: number }).sort_order ?? -1));
    }
  }
  return max;
}

export async function createUserDashboardStickyNote(
  userId: string,
  input?: { title?: string; body?: string; colorKey?: StickyNoteColorKey; sortOrder?: number },
): Promise<{ ok: boolean; note: DashboardStickyNote | null; tableMissing: boolean; error: string | null }> {
  const now = new Date().toISOString();
  const existingLocal = readLocalNotes(userId);
  const nextOrder = input?.sortOrder ?? (await maxSortOrderForUser(userId)) + 1;
  const colorKey =
    input?.colorKey ??
    STICKY_NOTE_COLOR_KEYS[nextOrder % STICKY_NOTE_COLOR_KEYS.length];

  const row = {
    user_id: userId,
    title: String(input?.title ?? 'New note').trim() || 'New note',
    body: String(input?.body ?? '').trim(),
    color_key: colorKey,
    sort_order: nextOrder,
    updated_at: now,
  };

  const { data, error } = await supabase.from(TABLE).insert(row).select().single();

  if (error) {
    if (isMissingTableError(error)) {
      const note: DashboardStickyNote = {
        id: crypto.randomUUID(),
        userId,
        title: row.title,
        body: row.body,
        colorKey,
        sortOrder: nextOrder,
        createdAt: now,
        updatedAt: now,
      };
      const notes = sortNotes([...existingLocal, note]);
      writeLocalNotes(userId, notes);
      return { ok: true, note, tableMissing: true, error: null };
    }
    return { ok: false, note: null, tableMissing: false, error: error.message };
  }

  const note = rowToNote(data as Record<string, unknown>);
  const merged = sortNotes([...existingLocal.filter((n) => n.id !== note.id), note]);
  writeLocalNotes(userId, merged);
  return { ok: true, note, tableMissing: false, error: null };
}

export async function updateUserDashboardStickyNote(
  userId: string,
  noteId: string,
  patch: Partial<Pick<DashboardStickyNote, 'title' | 'body' | 'colorKey' | 'sortOrder'>>,
): Promise<{ ok: boolean; tableMissing: boolean; error: string | null }> {
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.body !== undefined) updates.body = patch.body;
  if (patch.colorKey !== undefined) updates.color_key = patch.colorKey;
  if (patch.sortOrder !== undefined) updates.sort_order = patch.sortOrder;

  const { error } = await supabase.from(TABLE).update(updates).eq('user_id', userId).eq('id', noteId);

  if (error) {
    if (isMissingTableError(error)) {
      const notes = readLocalNotes(userId).map((n) =>
        n.id === noteId
          ? {
              ...n,
              title: patch.title ?? n.title,
              body: patch.body ?? n.body,
              colorKey: patch.colorKey ?? n.colorKey,
              sortOrder: patch.sortOrder ?? n.sortOrder,
              updatedAt: new Date().toISOString(),
            }
          : n,
      );
      writeLocalNotes(userId, sortNotes(notes));
      return { ok: true, tableMissing: true, error: null };
    }
    return { ok: false, tableMissing: false, error: error.message };
  }

  const { notes } = await listUserDashboardStickyNotes(userId, { skipLegacyImport: true });
  const next = notes.map((n) =>
    n.id === noteId
      ? {
          ...n,
          title: patch.title ?? n.title,
          body: patch.body ?? n.body,
          colorKey: patch.colorKey ?? n.colorKey,
          sortOrder: patch.sortOrder ?? n.sortOrder,
          updatedAt: new Date().toISOString(),
        }
      : n,
  );
  writeLocalNotes(userId, sortNotes(next));
  return { ok: true, tableMissing: false, error: null };
}

export async function deleteUserDashboardStickyNote(
  userId: string,
  noteId: string,
): Promise<{ ok: boolean; tableMissing: boolean; error: string | null }> {
  const { error } = await supabase.from(TABLE).delete().eq('user_id', userId).eq('id', noteId);

  if (error) {
    if (isMissingTableError(error)) {
      writeLocalNotes(
        userId,
        readLocalNotes(userId).filter((n) => n.id !== noteId),
      );
      return { ok: true, tableMissing: true, error: null };
    }
    return { ok: false, tableMissing: false, error: error.message };
  }

  writeLocalNotes(
    userId,
    (await listUserDashboardStickyNotes(userId, { skipLegacyImport: true })).notes.filter((n) => n.id !== noteId),
  );
  return { ok: true, tableMissing: false, error: null };
}

export async function reorderUserDashboardStickyNotes(
  userId: string,
  orderedIds: string[],
): Promise<{ ok: boolean; tableMissing: boolean; error: string | null }> {
  const { notes, tableMissing } = await listUserDashboardStickyNotes(userId);
  const byId = new Map(notes.map((n) => [n.id, n]));
  const reordered: DashboardStickyNote[] = [];
  orderedIds.forEach((id, index) => {
    const note = byId.get(id);
    if (note) reordered.push({ ...note, sortOrder: index });
  });
  for (const note of notes) {
    if (!orderedIds.includes(note.id)) reordered.push({ ...note, sortOrder: reordered.length });
  }

  if (tableMissing) {
    writeLocalNotes(userId, sortNotes(reordered));
    return { ok: true, tableMissing: true, error: null };
  }

  const results = await Promise.all(
    reordered.map((note, index) =>
      updateUserDashboardStickyNote(userId, note.id, { sortOrder: index }),
    ),
  );
  const failed = results.find((r) => !r.ok);
  return { ok: !failed, tableMissing: false, error: failed?.error ?? null };
}
