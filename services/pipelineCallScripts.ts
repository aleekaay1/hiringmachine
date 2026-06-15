import { supabase } from './supabaseClient';
import { draftCallScriptFields } from '../content/defaultCallScript';

const TABLE = 'pipeline_call_scripts';
const LS_PREFIX = 'pohiring_call_scripts_v1';

export type PipelineCallScript = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  sort_order: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

type LocalScriptStore = {
  scripts: PipelineCallScript[];
  updatedAt: string;
};

function isMissingTableError(error: { code?: string; message?: string; details?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === 'PGRST116') return true;
  const m = `${error.message || ''} ${error.details || ''}`;
  if (/404/.test(m) || /not found/i.test(m)) return true;
  return /pipeline_call_scripts/i.test(m) && /schema cache|does not exist|relation/i.test(m);
}

function shouldUseLocalScriptFallback(error: { code?: string; message?: string; details?: string } | null): boolean {
  if (!error) return false;
  if (isMissingTableError(error)) return true;
  if (error.code === '22003') return true;
  const m = `${error.message || ''} ${error.details || ''}`.toLowerCase();
  return (
    m.includes('integer out of range') ||
    m.includes('invalid input') ||
    (m.includes('pipeline_call_scripts') && m.includes('400'))
  );
}

function localKey(userId: string): string {
  return `${LS_PREFIX}:${userId}`;
}

function readLocalScripts(userId: string): PipelineCallScript[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(localKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalScriptStore;
    return Array.isArray(parsed.scripts) ? parsed.scripts : [];
  } catch {
    return [];
  }
}

function writeLocalScripts(userId: string, scripts: PipelineCallScript[]): void {
  if (typeof window === 'undefined') return;
  const payload: LocalScriptStore = { scripts, updatedAt: new Date().toISOString() };
  window.localStorage.setItem(localKey(userId), JSON.stringify(payload));
}

function newLocalScript(userId: string, title: string, body: string, isDefault: boolean): PipelineCallScript {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    user_id: userId,
    title,
    body,
    sort_order: 0,
    is_default: isDefault,
    created_at: now,
    updated_at: now,
  };
}

export function lastUsedCallScriptStorageKey(userId: string): string {
  return `${LS_PREFIX}:last:${userId}`;
}

export function readLastUsedCallScriptId(userId: string): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(lastUsedCallScriptStorageKey(userId));
}

export function saveLastUsedCallScriptId(userId: string, scriptId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(lastUsedCallScriptStorageKey(userId), scriptId);
}

export async function listPipelineCallScripts(userId: string): Promise<{
  scripts: PipelineCallScript[];
  tableMissing: boolean;
}> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true })
    .order('updated_at', { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      return { scripts: readLocalScripts(userId), tableMissing: true };
    }
    throw new Error(error.message);
  }

  const scripts = (data || []) as PipelineCallScript[];
  writeLocalScripts(userId, scripts);
  return { scripts, tableMissing: false };
}

export async function createPipelineCallScript(
  userId: string,
  input: { title?: string; body?: string; isDefault?: boolean; sortOrder?: number },
): Promise<{ script: PipelineCallScript; tableMissing: boolean }> {
  const title = String(input.title || 'My script').trim() || 'My script';
  const body = String(input.body || '');
  const now = new Date().toISOString();
  const row = {
    user_id: userId,
    title,
    body,
    sort_order: typeof input.sortOrder === 'number' ? input.sortOrder : 0,
    is_default: Boolean(input.isDefault),
    updated_at: now,
  };

  const { data, error } = await supabase.from(TABLE).insert(row).select('*').single();
  if (error) {
    if (shouldUseLocalScriptFallback(error)) {
      const scripts = readLocalScripts(userId);
      const script = newLocalScript(userId, title, body, scripts.length === 0 || Boolean(input.isDefault));
      script.sort_order = row.sort_order;
      if (script.is_default) {
        for (const item of scripts) item.is_default = false;
      }
      scripts.unshift(script);
      writeLocalScripts(userId, scripts);
      return { script, tableMissing: isMissingTableError(error) };
    }
    throw new Error(error.message);
  }

  const script = data as PipelineCallScript;
  if (script.is_default) {
    await clearOtherDefaultScripts(userId, script.id);
  }
  return { script, tableMissing: false };
}

async function clearOtherDefaultScripts(userId: string, keepId: string): Promise<void> {
  await supabase
    .from(TABLE)
    .update({ is_default: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .neq('id', keepId)
    .eq('is_default', true);
}

export async function updatePipelineCallScript(
  scriptId: string,
  userId: string,
  input: { title?: string; body?: string; isDefault?: boolean },
): Promise<{ script: PipelineCallScript; tableMissing: boolean }> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.title !== undefined) patch.title = String(input.title).trim() || 'My script';
  if (input.body !== undefined) patch.body = String(input.body);
  if (input.isDefault !== undefined) patch.is_default = input.isDefault;

  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq('id', scriptId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) {
    if (shouldUseLocalScriptFallback(error)) {
      const scripts = readLocalScripts(userId);
      const idx = scripts.findIndex((s) => s.id === scriptId);
      if (idx < 0) throw new Error('Script not found');
      const current = scripts[idx];
      if (input.title !== undefined) current.title = String(input.title).trim() || 'My script';
      if (input.body !== undefined) current.body = String(input.body);
      if (input.isDefault !== undefined) {
        current.is_default = input.isDefault;
        if (input.isDefault) {
          for (const item of scripts) {
            if (item.id !== scriptId) item.is_default = false;
          }
        }
      }
      current.updated_at = new Date().toISOString();
      writeLocalScripts(userId, scripts);
      return { script: current, tableMissing: isMissingTableError(error) };
    }
    throw new Error(error.message);
  }

  const script = data as PipelineCallScript;
  if (script.is_default) {
    await clearOtherDefaultScripts(userId, script.id);
  }
  return { script, tableMissing: false };
}

export async function deletePipelineCallScript(
  scriptId: string,
  userId: string,
): Promise<{ ok: boolean; tableMissing: boolean }> {
  const { error } = await supabase.from(TABLE).delete().eq('id', scriptId).eq('user_id', userId);
  if (error) {
    if (shouldUseLocalScriptFallback(error)) {
      const scripts = readLocalScripts(userId).filter((s) => s.id !== scriptId);
      writeLocalScripts(userId, scripts);
      return { ok: true, tableMissing: isMissingTableError(error) };
    }
    throw new Error(error.message);
  }
  return { ok: true, tableMissing: false };
}

export async function loadOrSeedPipelineCallScripts(userId: string): Promise<{
  scripts: PipelineCallScript[];
  tableMissing: boolean;
}> {
  const { scripts, tableMissing } = await listPipelineCallScripts(userId);
  if (scripts.length > 0 || tableMissing) return { scripts, tableMissing };

  const draft = draftCallScriptFields();
  const { script, tableMissing: seedTableMissing } = await createPipelineCallScript(userId, {
    title: draft.title,
    body: draft.body,
    isDefault: true,
    sortOrder: 0,
  });
  return { scripts: [script], tableMissing: seedTableMissing };
}

export function pickActiveCallScript(
  scripts: PipelineCallScript[],
  userId: string,
): PipelineCallScript | null {
  if (!scripts.length) return null;
  const lastId = readLastUsedCallScriptId(userId);
  if (lastId) {
    const last = scripts.find((s) => s.id === lastId);
    if (last) return last;
  }
  return scripts.find((s) => s.is_default) ?? scripts[0];
}
