import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Plus, ScrollText, Star, Trash2, X } from 'lucide-react';
import { Button } from '../UI';
import type { PipelineCallScript } from '../../services/pipelineCallScripts';
import {
  createPipelineCallScript,
  deletePipelineCallScript,
  saveLastUsedCallScriptId,
  updatePipelineCallScript,
} from '../../services/pipelineCallScripts';

export type CallScriptsDrawerTone = {
  glassPanel: string;
  panelTitle: string;
  panelMuted: string;
  panelLabel: string;
  input: string;
  actionButton: string;
  subtle: string;
  modalBackdrop: string;
};

type CallScriptsDrawerProps = {
  open: boolean;
  userId: string;
  scripts: PipelineCallScript[];
  selectedScriptId: string | null;
  tableMissing: boolean;
  onClose: () => void;
  onScriptsChange: (scripts: PipelineCallScript[], selectedId: string | null) => void;
  tone: CallScriptsDrawerTone;
};

const CallScriptsDrawer: React.FC<CallScriptsDrawerProps> = ({
  open,
  userId,
  scripts,
  selectedScriptId,
  tableMissing,
  onClose,
  onScriptsChange,
  tone,
}) => {
  const selected = scripts.find((s) => s.id === selectedScriptId) ?? scripts[0] ?? null;
  const [title, setTitle] = React.useState(selected?.title ?? '');
  const [body, setBody] = React.useState(selected?.body ?? '');
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  React.useEffect(() => {
    setTitle(selected?.title ?? '');
    setBody(selected?.body ?? '');
    setStatus(null);
  }, [selected?.id, selected?.title, selected?.body]);

  const refreshList = (next: PipelineCallScript[], selectedId: string | null) => {
    onScriptsChange(next, selectedId);
    if (selectedId) saveLastUsedCallScriptId(userId, selectedId);
  };

  const addScript = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const { script } = await createPipelineCallScript(userId, {
        title: `Script ${scripts.length + 1}`,
        body: '',
        isDefault: scripts.length === 0,
      });
      const next = [script, ...scripts.map((s) => ({ ...s, is_default: script.is_default ? false : s.is_default }))];
      refreshList(next, script.id);
      setStatus('New script created');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const saveCurrent = async () => {
    if (!selected) return;
    setSaving(true);
    setStatus(null);
    try {
      const { script } = await updatePipelineCallScript(selected.id, userId, { title, body });
      const next = scripts.map((s) => (s.id === script.id ? script : s));
      refreshList(next, script.id);
      setStatus('Saved');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (scriptId: string) => {
    setSaving(true);
    setStatus(null);
    try {
      const { script } = await updatePipelineCallScript(scriptId, userId, { isDefault: true });
      const next = scripts.map((s) => ({ ...s, is_default: s.id === script.id }));
      refreshList(next, script.id);
      setStatus('Default script updated');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const removeScript = async (scriptId: string) => {
    if (!window.confirm('Delete this script?')) return;
    setSaving(true);
    setStatus(null);
    try {
      await deletePipelineCallScript(scriptId, userId);
      const next = scripts.filter((s) => s.id !== scriptId);
      const fallback = next.find((s) => s.is_default) ?? next[0] ?? null;
      refreshList(next, fallback?.id ?? null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`fixed inset-0 z-[240] ${tone.modalBackdrop}`}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className={`absolute right-0 top-0 flex h-full w-full max-w-[520px] flex-col border-l shadow-2xl ${tone.glassPanel}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="call-scripts-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[#d4e4f7]/80 px-4 py-3">
              <div className="flex items-center gap-2">
                <ScrollText size={18} className="text-[#4e9ae8]" />
                <div>
                  <h2 id="call-scripts-title" className={`text-sm font-semibold ${tone.panelTitle}`}>
                    My call scripts
                  </h2>
                  <p className={`text-[11px] ${tone.panelMuted}`}>Paste your script — only you can see it</p>
                </div>
              </div>
              <button type="button" onClick={onClose} className={`rounded-lg border p-2 ${tone.actionButton}`} aria-label="Close scripts">
                <X size={16} />
              </button>
            </div>

            {tableMissing && (
              <p className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                Run <code className="font-mono">paste_pipeline_call_scripts.sql</code> in Supabase to sync across devices.
                Saving locally until then.
              </p>
            )}

            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${tone.panelLabel}`}>Your scripts</p>
                <Button variant="outline" className="!min-h-0 h-8 px-3 text-xs" onClick={() => void addScript()} disabled={saving}>
                  <Plus size={14} className="mr-1" />
                  Add script
                </Button>
              </div>

              <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                {scripts.length === 0 && (
                  <p className={`text-xs ${tone.panelMuted}`}>No scripts yet — add one and paste your talking points.</p>
                )}
                {scripts.map((script) => {
                  const active = script.id === (selected?.id ?? '');
                  return (
                    <div key={script.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          saveLastUsedCallScriptId(userId, script.id);
                          onScriptsChange(scripts, script.id);
                        }}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                          active ? 'border-[#4e9ae8] bg-[#e8f3ff] text-[#0B1B34]' : tone.actionButton
                        }`}
                      >
                        {script.title}
                        {script.is_default ? ' ★' : ''}
                      </button>
                      <button
                        type="button"
                        title="Set as default"
                        onClick={() => void setDefault(script.id)}
                        className={`rounded-lg border p-1 ${script.is_default ? 'border-amber-300 bg-amber-50 text-amber-700' : tone.actionButton}`}
                      >
                        <Star size={12} fill={script.is_default ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        type="button"
                        title="Delete script"
                        onClick={() => void removeScript(script.id)}
                        className={`rounded-lg border p-1 text-rose-600 ${tone.actionButton}`}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>

              {selected ? (
                <div className={`flex min-h-0 flex-1 flex-col rounded-2xl border p-3 ${tone.subtle}`}>
                  <label className={`text-[11px] font-semibold ${tone.panelLabel}`}>
                    Title
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className={`mt-1 w-full rounded-lg border px-2.5 py-2 text-sm ${tone.input}`}
                    />
                  </label>
                  <label className={`mt-3 flex min-h-0 flex-1 flex-col text-[11px] font-semibold ${tone.panelLabel}`}>
                    Script
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="Paste your call script here…"
                      className={`mt-1 min-h-[240px] flex-1 resize-y rounded-xl border px-3 py-3 text-sm leading-relaxed ${tone.input}`}
                    />
                  </label>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Button className="!min-h-0 h-9 px-4 text-xs" onClick={() => void saveCurrent()} disabled={saving}>
                      {saving ? 'Saving…' : 'Save script'}
                    </Button>
                    {status && <p className={`text-[11px] ${status === 'Saved' || status.includes('created') || status.includes('Default') ? 'text-emerald-700' : 'text-red-600'}`}>{status}</p>}
                  </div>
                </div>
              ) : (
                <div className={`rounded-2xl border p-6 text-center text-sm ${tone.subtle} ${tone.panelMuted}`}>
                  Add a script to get started.
                </div>
              )}
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default CallScriptsDrawer;
