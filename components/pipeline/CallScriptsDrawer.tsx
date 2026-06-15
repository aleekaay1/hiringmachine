import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Maximize2, Minimize2, Plus, RotateCcw, ScrollText, Star, Trash2, X } from 'lucide-react';
import { draftCallScriptFields } from '../../content/defaultCallScript';
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
  const isDraft = scripts.length === 0;
  const selected = scripts.find((s) => s.id === selectedScriptId) ?? scripts[0] ?? null;
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [editorExpanded, setEditorExpanded] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const applyFields = React.useCallback(
    (nextTitle: string, nextBody: string) => {
      setTitle(nextTitle);
      setBody(nextBody);
      setStatus(null);
    },
    [],
  );

  React.useEffect(() => {
    if (!open) {
      setEditorExpanded(false);
      return;
    }
    if (isDraft) {
      const draft = draftCallScriptFields();
      applyFields(draft.title, draft.body);
      return;
    }
    if (selected) {
      applyFields(selected.title, selected.body);
    }
  }, [open, isDraft, selected?.id, selected?.title, selected?.body, applyFields]);

  const refreshList = (next: PipelineCallScript[], selectedId: string | null) => {
    onScriptsChange(next, selectedId);
    if (selectedId) saveLastUsedCallScriptId(userId, selectedId);
  };

  const saveCurrent = async () => {
    setSaving(true);
    setStatus(null);
    try {
      if (isDraft || !selected) {
        const { script } = await createPipelineCallScript(userId, {
          title,
          body,
          isDefault: true,
          sortOrder: 0,
        });
        refreshList([script], script.id);
        setStatus('Script saved');
        return;
      }

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

  const addScript = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const { script } = await createPipelineCallScript(userId, {
        title: `Script ${scripts.length + 1}`,
        body: '',
        isDefault: false,
        sortOrder: scripts.length,
      });
      const next = [...scripts, script];
      refreshList(next, script.id);
      applyFields(script.title, script.body);
      setStatus('New script added — paste and save');
      window.setTimeout(() => textareaRef.current?.focus(), 50);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const resetToPazTemplate = () => {
    const draft = draftCallScriptFields();
    applyFields(draft.title, draft.body);
    setStatus('Paz template loaded — click Save script when ready');
    textareaRef.current?.focus();
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
      if (!fallback) {
        const draft = draftCallScriptFields();
        applyFields(draft.title, draft.body);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const expandEditor = () => {
    setEditorExpanded(true);
    window.setTimeout(() => textareaRef.current?.focus(), 50);
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
            className={`absolute right-0 top-0 flex h-full flex-col border-l shadow-2xl ${tone.glassPanel} ${
              editorExpanded ? 'w-full max-w-[min(96vw,920px)]' : 'w-full max-w-[560px]'
            }`}
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
                  <p className={`text-[11px] ${tone.panelMuted}`}>
                    Click the box, paste your script, save — only you see it
                  </p>
                </div>
              </div>
              <button type="button" onClick={onClose} className={`rounded-lg border p-2 ${tone.actionButton}`} aria-label="Close scripts">
                <X size={16} />
              </button>
            </div>

            {tableMissing && (
              <p className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                Run <code className="font-mono">paste_pipeline_call_scripts.sql</code> in Supabase to sync across devices.
              </p>
            )}

            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              {!isDraft && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${tone.panelLabel}`}>Your scripts</p>
                  <Button variant="outline" className="!min-h-0 h-8 px-3 text-xs" onClick={() => void addScript()} disabled={saving}>
                    <Plus size={14} className="mr-1" />
                    Add another
                  </Button>
                </div>
              )}

              {!isDraft && (
                <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
                  {scripts.map((script) => {
                    const active = script.id === (selected?.id ?? '');
                    return (
                      <div key={script.id} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            saveLastUsedCallScriptId(userId, script.id);
                            onScriptsChange(scripts, script.id);
                            applyFields(script.title, script.body);
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
              )}

              <div className={`flex min-h-0 flex-1 flex-col rounded-2xl border p-3 ${tone.subtle}`}>
                {isDraft && (
                  <p className={`mb-2 text-xs ${tone.panelMuted}`}>
                    Starter script from <span className="font-semibold text-[#0B1B34]">Globelife Paz Organization</span> — edit or replace, then save.
                  </p>
                )}

                <label className={`text-[11px] font-semibold ${tone.panelLabel}`}>
                  Title
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className={`mt-1 w-full rounded-lg border px-2.5 py-2 text-sm ${tone.input}`}
                  />
                </label>

                <div className="mt-3 flex min-h-0 flex-1 flex-col">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className={`text-[11px] font-semibold ${tone.panelLabel}`}>Script</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={resetToPazTemplate}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold ${tone.actionButton}`}
                      >
                        <RotateCcw size={12} />
                        Paz template
                      </button>
                      <button
                        type="button"
                        onClick={() => (editorExpanded ? setEditorExpanded(false) : expandEditor())}
                        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-semibold ${tone.actionButton}`}
                      >
                        {editorExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                        {editorExpanded ? 'Compact' : 'Expand'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    ref={textareaRef}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    onFocus={() => {
                      if (!editorExpanded) setEditorExpanded(true);
                    }}
                    placeholder="Click here and paste your call script…"
                    className={`w-full flex-1 resize-y rounded-xl border px-3 py-3 font-mono text-[13px] leading-6 ${tone.input} ${
                      editorExpanded ? 'min-h-[min(72vh,640px)]' : 'min-h-[280px]'
                    }`}
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <Button className="!min-h-0 h-9 px-4 text-xs" onClick={() => void saveCurrent()} disabled={saving}>
                    {saving ? 'Saving…' : isDraft ? 'Save script' : 'Save changes'}
                  </Button>
                  {status && (
                    <p
                      className={`text-[11px] ${
                        status === 'Saved' ||
                        status === 'Script saved' ||
                        status.includes('template') ||
                        status.includes('added') ||
                        status.includes('Default')
                          ? 'text-emerald-700'
                          : 'text-red-600'
                      }`}
                    >
                      {status}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default CallScriptsDrawer;
