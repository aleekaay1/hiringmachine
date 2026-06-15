import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ScrollText, X } from 'lucide-react';
import type { PipelineCallScript } from '../../services/pipelineCallScripts';

export type CallScriptViewerTone = {
  glassPanel: string;
  panelTitle: string;
  panelMuted: string;
  panelLabel: string;
  input: string;
  actionButton: string;
  modalBackdrop: string;
};

type CallScriptViewerModalProps = {
  open: boolean;
  scripts: PipelineCallScript[];
  activeScriptId: string | null;
  onSelectScript: (scriptId: string) => void;
  onClose: () => void;
  tone: CallScriptViewerTone;
};

const CallScriptViewerModal: React.FC<CallScriptViewerModalProps> = ({
  open,
  scripts,
  activeScriptId,
  onSelectScript,
  onClose,
  tone,
}) => {
  const active = scripts.find((s) => s.id === activeScriptId) ?? scripts[0] ?? null;

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`fixed inset-0 z-[260] flex items-center justify-center p-4 ${tone.modalBackdrop}`}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            className={`flex max-h-[min(88vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border shadow-2xl ${tone.glassPanel}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="call-script-viewer-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#d4e4f7]/80 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ScrollText size={18} className="shrink-0 text-[#4e9ae8]" />
                  <h3 id="call-script-viewer-title" className={`truncate text-base font-semibold ${tone.panelTitle}`}>
                    {active?.title || 'Call script'}
                  </h3>
                </div>
                <p className={`mt-0.5 text-[11px] ${tone.panelMuted}`}>Read while you dispose or open webinar verify</p>
              </div>
              <button type="button" onClick={onClose} className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${tone.actionButton}`}>
                <X size={14} className="inline" /> Close
              </button>
            </div>

            {scripts.length > 1 && (
              <div className="shrink-0 border-b border-[#d4e4f7]/60 px-4 py-2">
                <label className={`flex items-center gap-2 text-[11px] font-semibold ${tone.panelLabel}`}>
                  Script
                  <div className="relative min-w-0 flex-1">
                    <select
                      value={active?.id ?? ''}
                      onChange={(e) => onSelectScript(e.target.value)}
                      className={`w-full appearance-none rounded-lg border py-2 pl-3 pr-8 text-xs ${tone.input}`}
                    >
                      {scripts.map((script) => (
                        <option key={script.id} value={script.id}>
                          {script.title}
                          {script.is_default ? ' (default)' : ''}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 ${tone.panelMuted}`} />
                  </div>
                </label>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {active?.body?.trim() ? (
                <article className="rounded-xl border border-[#d4e4f7] bg-[#f8fbff] px-4 py-4 text-[15px] leading-7 text-[#0B1B34] shadow-inner">
                  <div className="whitespace-pre-wrap break-words font-[450] tracking-[0.01em]">{active.body}</div>
                </article>
              ) : (
                <div className={`rounded-xl border border-dashed px-4 py-8 text-center text-sm ${tone.panelMuted}`}>
                  This script is empty. Open the Scripts tab on the workspace to paste your talking points.
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default CallScriptViewerModal;
