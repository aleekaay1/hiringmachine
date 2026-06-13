import React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, Mail, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '../UI';
import { sendEmail } from '../../services/emailService';
import { appendEmailSignatureToHtml } from '../../services/emailSignatureHtml';
import { EMAIL_TEMPLATES, mergeTemplate } from '../../services/emailTemplates';
import { fetchNextUpcomingLiveSession } from '../../services/liveSessionOccurrences';
import { supabase } from '../../services/supabaseClient';
import type { PipelineCandidate } from '../../services/pipelineService';

export type PostDispositionEmailTone = {
  glassPanel: string;
  panelTitle: string;
  panelMuted: string;
  panelLabel: string;
  input: string;
  actionButton: string;
  modalBackdrop: string;
};

type PostDispositionEmailModalProps = {
  open: boolean;
  candidate: PipelineCandidate;
  toEmail: string;
  disposition: string;
  onClose: () => void;
  onSent?: () => void;
};

function plainToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.split('\n').map((line) => `<p style="margin:0 0 12px;">${line || '&nbsp;'}</p>`).join('');
}

const PostDispositionEmailModal: React.FC<PostDispositionEmailModalProps> = ({
  open,
  candidate,
  toEmail,
  disposition,
  onClose,
  onSent,
}) => {
  const [templateId, setTemplateId] = React.useState('');
  const [subject, setSubject] = React.useState('Quick follow-up from Paz Organization');
  const [bodyPlain, setBodyPlain] = React.useState('');
  const [bodyHtml, setBodyHtml] = React.useState('');
  const [useHtml, setUseHtml] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const name = (candidate.full_name || '').trim() || 'there';
    setTemplateId('');
    setSubject('Quick follow-up from Paz Organization');
    setBodyPlain(`Hi ${name},\n\nThank you for speaking with us today.\n\n`);
    setBodyHtml('');
    setUseHtml(false);
    setMessage(null);
  }, [open, candidate.id, candidate.full_name]);

  const applyTemplate = async (id: string) => {
    setTemplateId(id);
    if (!id) return;
    const template = EMAIL_TEMPLATES.find((item) => item.id === id);
    if (!template) return;
    const nameParts = String(candidate.full_name || '').trim().split(/\s+/);
    const liveSessionOccurrence =
      id === 'stage2_post_checkin' ? await fetchNextUpcomingLiveSession() : null;
    const merged = mergeTemplate(
      template.subject,
      template.bodyHtml,
      {
        firstName: nameParts[0] || '',
        lastName: nameParts.slice(1).join(' '),
        email: toEmail || candidate.email || '',
        phone: candidate.phone || '',
      },
      undefined,
      { siteOrigin: typeof window !== 'undefined' ? window.location.origin : '', liveSessionOccurrence },
    );
    setSubject(merged.subject);
    setBodyHtml(merged.bodyHtml);
    setBodyPlain('');
    setUseHtml(true);
  };

  const handleSend = async () => {
    if (!toEmail.trim()) {
      setMessage('Add an email address for this lead first.');
      return;
    }
    const core = useHtml ? bodyHtml.trim() : bodyPlain.trim();
    if (!core) {
      setMessage('Message is required.');
      return;
    }
    setSending(true);
    setMessage(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Not authenticated.');
      const html = useHtml ? appendEmailSignatureToHtml(bodyHtml) : appendEmailSignatureToHtml(plainToHtml(bodyPlain));
      const result = await sendEmail(token, {
        to: toEmail.trim(),
        subject: subject.trim() || 'Follow-up from Paz Organization',
        bodyHtml: html,
        candidateId: candidate.id,
        trigger: 'pipeline_call_workspace_post_disposition',
        attachLiveSessionCalendar: templateId === 'stage2_post_checkin',
      });
      if (!('ok' in result)) throw new Error(result.error || 'Failed to send email.');
      setMessage('Email sent.');
      onSent?.();
      window.setTimeout(onClose, 600);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const tone: PostDispositionEmailTone = {
    glassPanel: 'border-white/70 bg-white/95 backdrop-blur-xl shadow-2xl',
    panelTitle: 'text-[#0B1B34]',
    panelMuted: 'text-[#365274]',
    panelLabel: 'text-[#4b6d95]',
    input: 'border-[#bfd6ee] bg-white text-[#13243f]',
    actionButton: 'border-[#bad4ee] bg-white text-[#0B1B34] hover:bg-[#f4f8ff]',
    modalBackdrop: 'bg-[#102645]/40 backdrop-blur-sm',
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`fixed inset-0 z-[255] flex items-center justify-center p-4 ${tone.modalBackdrop}`}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            className={`w-full max-w-lg space-y-3 rounded-2xl border p-4 ${tone.glassPanel}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="post-disposition-email-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className={`text-xs ${tone.panelLabel}`}>Follow-up email · {disposition}</p>
                <h3 id="post-disposition-email-title" className={`text-base font-semibold ${tone.panelTitle}`}>
                  Email {candidate.full_name || 'candidate'}?
                </h3>
                <p className={`text-[11px] ${tone.panelLabel}`}>Optional — skip if you already covered it on the call.</p>
              </div>
              <button type="button" onClick={onClose} className={`rounded-lg border px-2 py-1 ${tone.actionButton}`} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            <label className={`block text-xs ${tone.panelMuted}`}>
              Template
              <select
                value={templateId}
                onChange={(e) => void applyTemplate(e.target.value)}
                className={`mt-1 w-full rounded-lg border px-2 py-2 text-xs ${tone.input}`}
              >
                <option value="">Quick follow-up (default)</option>
                {EMAIL_TEMPLATES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <label className={`block text-xs ${tone.panelMuted}`}>
              To
              <input value={toEmail} readOnly className={`mt-1 w-full rounded-lg border px-2 py-2 text-xs ${tone.input} opacity-80`} />
            </label>

            <label className={`block text-xs ${tone.panelMuted}`}>
              Subject
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className={`mt-1 w-full rounded-lg border px-2 py-2 text-xs ${tone.input}`} />
            </label>

            {!useHtml ? (
              <label className={`block text-xs ${tone.panelMuted}`}>
                Message
                <textarea
                  value={bodyPlain}
                  onChange={(e) => setBodyPlain(e.target.value)}
                  rows={5}
                  className={`mt-1 w-full rounded-lg border px-2 py-2 text-xs ${tone.input}`}
                />
              </label>
            ) : (
              <p className={`text-xs ${tone.panelMuted}`}>Using HTML template — open full email workspace to preview before sending if needed.</p>
            )}

            {message && (
              <p className={`text-xs ${message.includes('sent') ? 'text-emerald-700' : 'text-red-600'}`}>{message}</p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button className="min-w-0 flex-1" onClick={() => void handleSend()} disabled={sending}>
                <Mail size={14} className="mr-1.5" />
                {sending ? 'Sending…' : 'Send email'}
              </Button>
              <Button variant="outline" onClick={onClose} disabled={sending}>
                Skip
              </Button>
            </div>

            <Link
              to={`/pipeline/email?candidateId=${encodeURIComponent(candidate.id)}`}
              className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${tone.actionButton}`}
              onClick={onClose}
            >
              Open full email workspace
              <ExternalLink size={12} />
            </Link>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default PostDispositionEmailModal;
