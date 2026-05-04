import { supabase } from './supabaseClient';
import type { AdminNote } from '../types';

const TABLE = 'webinar_geek_hr_note_entries';
const CHUNK = 120;

function rowToNote(row: { id: string; body: string; author_label: string | null; created_at: string }): AdminNote {
  return {
    id: row.id,
    createdAt: row.created_at,
    text: row.body,
    authorEmail: row.author_label?.trim() || undefined,
  };
}

/** Load all note entries for the given WebinarGeek subscription ids (deduped, sorted oldest→newest per id). */
export async function fetchWebinarGeekNotesForIds(subscriptionIds: string[]): Promise<Map<string, AdminNote[]>> {
  const map = new Map<string, AdminNote[]>();
  const unique = [...new Set(subscriptionIds.map((id) => String(id)).filter(Boolean))];
  if (unique.length === 0) return map;

  for (let i = 0; i < unique.length; i += CHUNK) {
    const slice = unique.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from(TABLE)
      .select('id, subscription_id, body, author_label, created_at')
      .in('subscription_id', slice)
      .order('created_at', { ascending: true });
    if (error) throw error;
    for (const raw of data || []) {
      const row = raw as {
        id: string;
        subscription_id: string;
        body: string;
        author_label: string | null;
        created_at: string;
      };
      const sid = String(row.subscription_id);
      const list = map.get(sid) ?? [];
      list.push(rowToNote(row));
      map.set(sid, list);
    }
  }
  return map;
}

export async function insertWebinarGeekHrNote(
  subscriptionId: string,
  body: string,
  authorLabel?: string | null,
): Promise<AdminNote> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      subscription_id: String(subscriptionId),
      body: body.trim(),
      author_label: authorLabel?.trim() || null,
    })
    .select('id, body, author_label, created_at')
    .single();
  if (error) throw error;
  const row = data as { id: string; body: string; author_label: string | null; created_at: string };
  return rowToNote(row);
}

export function latestWebinarGeekNote(notes: AdminNote[] | undefined): AdminNote | null {
  if (!notes?.length) return null;
  return [...notes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}
