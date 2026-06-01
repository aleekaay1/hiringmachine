import React from 'react';
import { ChevronDown, GripVertical, Plus, StickyNote, Trash2 } from 'lucide-react';
import {
  createUserDashboardStickyNote,
  deleteUserDashboardStickyNote,
  listUserDashboardStickyNotes,
  reorderUserDashboardStickyNotes,
  STICKY_NOTE_COLOR_KEYS,
  updateUserDashboardStickyNote,
  type DashboardStickyNote,
  type StickyNoteColorKey,
} from '../../services/userDashboardStickyNotes';

const NOTE_STYLES: Record<
  StickyNoteColorKey,
  { wrap: string; header: string; headerText: string; body: string; ring: string }
> = {
  amber: {
    wrap: 'border-[#f0ce8f] bg-gradient-to-br from-[#fff8ea] via-[#fffaf2] to-white',
    header: 'bg-[#fff3d6]/90 hover:bg-[#ffefcc]',
    headerText: 'text-[#7a5500]',
    body: 'border-t border-[#f0ce8f]/60 bg-white/70',
    ring: 'focus-within:ring-[#ffe9b8]',
  },
  sky: {
    wrap: 'border-[#b8ddf5] bg-gradient-to-br from-[#eef7ff] via-[#f5fbff] to-white',
    header: 'bg-[#e3f2fc]/90 hover:bg-[#d9edfb]',
    headerText: 'text-[#1e5f8a]',
    body: 'border-t border-[#b8ddf5]/70 bg-white/70',
    ring: 'focus-within:ring-[#cce9ff]',
  },
  mint: {
    wrap: 'border-[#b8e8d4] bg-gradient-to-br from-[#effbf4] via-[#f6fdf9] to-white',
    header: 'bg-[#dff5ea]/90 hover:bg-[#d4f0e3]',
    headerText: 'text-[#1f6b47]',
    body: 'border-t border-[#b8e8d4]/70 bg-white/70',
    ring: 'focus-within:ring-[#c8f0dc]',
  },
  rose: {
    wrap: 'border-[#f5c4d4] bg-gradient-to-br from-[#fff5f8] via-[#fff9fb] to-white',
    header: 'bg-[#fde8ef]/90 hover:bg-[#fce0e9]',
    headerText: 'text-[#8a3050]',
    body: 'border-t border-[#f5c4d4]/70 bg-white/70',
    ring: 'focus-within:ring-[#fadce6]',
  },
  lavender: {
    wrap: 'border-[#d4c8f5] bg-gradient-to-br from-[#f7f4ff] via-[#faf8ff] to-white',
    header: 'bg-[#ece6ff]/90 hover:bg-[#e4dcff]',
    headerText: 'text-[#5340a8]',
    body: 'border-t border-[#d4c8f5]/70 bg-white/70',
    ring: 'focus-within:ring-[#e6ddff]',
  },
  peach: {
    wrap: 'border-[#f5d4b8] bg-gradient-to-br from-[#fff6ef] via-[#fffaf5] to-white',
    header: 'bg-[#fdebd8]/90 hover:bg-[#fce5cf]',
    headerText: 'text-[#8a4e22]',
    body: 'border-t border-[#f5d4b8]/70 bg-white/70',
    ring: 'focus-within:ring-[#ffe2c8]',
  },
};

function notePreview(body: string): string {
  const line = body.trim().split('\n')[0] || '';
  if (line.length <= 72) return line;
  return `${line.slice(0, 72)}…`;
}

export function DashboardStickyNotesPanel({ userId }: { userId: string }) {
  const [notes, setNotes] = React.useState<DashboardStickyNote[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [savedHint, setSavedHint] = React.useState<string | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const saveTimers = React.useRef<Map<string, number>>(new Map());

  const refresh = React.useCallback(async () => {
    const res = await listUserDashboardStickyNotes(userId);
    setNotes(res.notes);
    setExpandedId((prev) => (prev && res.notes.some((n) => n.id === prev) ? prev : res.notes[0]?.id ?? null));
    return res.notes;
  }, [userId]);

  React.useEffect(() => {
    let cancelled = false;
    void refresh().then(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const flashSaved = () => {
    setSavedHint('Saved');
    window.setTimeout(() => setSavedHint(null), 2000);
  };

  const persistNote = React.useCallback(
    async (noteId: string, patch: Partial<Pick<DashboardStickyNote, 'title' | 'body' | 'colorKey'>>) => {
      setSaving(true);
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, ...patch, updatedAt: new Date().toISOString() } : n)),
      );
      const res = await updateUserDashboardStickyNote(userId, noteId, patch);
      setSaving(false);
      if (res.ok) flashSaved();
    },
    [userId],
  );

  const scheduleSave = (noteId: string, patch: Partial<Pick<DashboardStickyNote, 'title' | 'body' | 'colorKey'>>) => {
    const existing = saveTimers.current.get(noteId);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      saveTimers.current.delete(noteId);
      void persistNote(noteId, patch);
    }, 500);
    saveTimers.current.set(noteId, timer);
  };

  const handleAdd = async () => {
    const res = await createUserDashboardStickyNote(userId, { title: 'New note', body: '' });
    if (!res.ok || !res.note) return;
    setNotes((prev) => [...prev, res.note!].sort((a, b) => a.sortOrder - b.sortOrder));
    setExpandedId(res.note.id);
  };

  const handleDelete = async (noteId: string) => {
    const res = await deleteUserDashboardStickyNote(userId, noteId);
    if (!res.ok) return;
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== noteId);
      setExpandedId((cur) => (cur === noteId ? next[0]?.id ?? null : cur));
      return next;
    });
  };

  const handleDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = notes.map((n) => n.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const nextIds = [...ids];
    nextIds.splice(from, 1);
    nextIds.splice(to, 0, dragId);
    const reordered = nextIds
      .map((id, index) => {
        const note = notes.find((n) => n.id === id);
        return note ? { ...note, sortOrder: index } : null;
      })
      .filter(Boolean) as DashboardStickyNote[];
    setNotes(reordered);
    setDragId(null);
    await reorderUserDashboardStickyNotes(userId, nextIds);
    flashSaved();
  };

  const patchLocal = (noteId: string, patch: Partial<Pick<DashboardStickyNote, 'title' | 'body' | 'colorKey'>>) => {
    setNotes((prev) => {
      const next = prev.map((n) => (n.id === noteId ? { ...n, ...patch } : n));
      const note = next.find((n) => n.id === noteId);
      if (note) {
        scheduleSave(noteId, { title: note.title, body: note.body, colorKey: note.colorKey });
      }
      return next;
    });
  };

  return (
    <div className="rounded-3xl border border-[#e8eef6] bg-white/90 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#4e79a9]">
            <StickyNote size={14} aria-hidden />
            My notes
          </p>
          <p className="mt-1 text-[11px] text-[#6d86a3]">
            Sticky notes for your shift — drag to reorder, one open at a time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-[#c5d9f0] bg-[#eef6ff] px-2.5 py-1.5 text-[11px] font-semibold text-[#1e5f8a] hover:bg-[#e3f0ff] disabled:opacity-50"
        >
          <Plus size={14} />
          Add note
        </button>
      </div>

      {loading && <p className="mt-4 text-xs text-[#7a8fa8]">Loading notes…</p>}

      {!loading && notes.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-[#d6e6f9] bg-[#f8fbff] px-3 py-6 text-center text-xs text-[#7a8fa8]">
          No notes yet. Click <strong>Add note</strong> to create your first sticky.
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {notes.map((note) => {
          const styles = NOTE_STYLES[note.colorKey] ?? NOTE_STYLES.amber;
          const expanded = expandedId === note.id;
          return (
            <li
              key={note.id}
              className={`overflow-hidden rounded-2xl border shadow-sm transition ${styles.wrap} ${expanded ? `ring-2 ring-offset-1 ${styles.ring}` : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={() => void handleDrop(note.id)}
            >
              <div
                role="button"
                tabIndex={0}
                className={`flex w-full items-center gap-1 px-2 py-2 text-left transition ${styles.header}`}
                onClick={() => setExpandedId((cur) => (cur === note.id ? null : note.id))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpandedId((cur) => (cur === note.id ? null : note.id));
                  }
                }}
              >
                <span
                  draggable
                  onDragStart={(e) => {
                    setDragId(note.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', note.id);
                  }}
                  onDragEnd={() => setDragId(null)}
                  className="cursor-grab touch-none px-1 text-[#9bafc9] active:cursor-grabbing"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Drag to reorder"
                >
                  <GripVertical size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-semibold ${styles.headerText}`}>
                    {note.title.trim() || 'Untitled note'}
                  </p>
                  {!expanded && note.body.trim() && (
                    <p className="truncate text-[11px] text-[#6d86a3]">{notePreview(note.body)}</p>
                  )}
                </div>
                <button
                  type="button"
                  className="rounded-lg p-1 text-[#9bafc9] hover:bg-white/60 hover:text-red-600"
                  aria-label="Delete note"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDelete(note.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
                <ChevronDown
                  size={16}
                  className={`shrink-0 text-[#7a8fa8] transition ${expanded ? 'rotate-180' : ''}`}
                />
              </div>

              {expanded && (
                <div className={`px-3 pb-3 pt-2 ${styles.body}`}>
                  <label className="block text-[10px] font-semibold uppercase tracking-wide text-[#7a8fa8]">
                    Title
                    <input
                      type="text"
                      value={note.title}
                      onChange={(e) => patchLocal(note.id, { title: e.target.value })}
                      onBlur={() => void persistNote(note.id, { title: note.title, body: note.body })}
                      className="mt-1 w-full rounded-lg border border-[#d6e6f9] bg-white px-2.5 py-1.5 text-sm text-[#0B1B34] focus:border-[#9bc8f6] focus:outline-none focus:ring-2 focus:ring-[#d9ecff]"
                      placeholder="Note title"
                    />
                  </label>
                  <label className="mt-2 block text-[10px] font-semibold uppercase tracking-wide text-[#7a8fa8]">
                    Details
                    <textarea
                      value={note.body}
                      onChange={(e) => patchLocal(note.id, { body: e.target.value })}
                      onBlur={() => void persistNote(note.id, { title: note.title, body: note.body })}
                      rows={4}
                      className="mt-1 w-full resize-y rounded-lg border border-[#d6e6f9] bg-white px-2.5 py-2 text-sm text-[#0B1B34] placeholder:text-[#9bafc9] focus:border-[#9bc8f6] focus:outline-none focus:ring-2 focus:ring-[#d9ecff]"
                      placeholder="Callbacks, priorities, follow-ups…"
                    />
                  </label>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[#7a8fa8]">Color</span>
                    {STICKY_NOTE_COLOR_KEYS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        title={key}
                        aria-label={`${key} color`}
                        onClick={() => {
                          patchLocal(note.id, { colorKey: key });
                          void persistNote(note.id, { colorKey: key });
                        }}
                        className={`h-5 w-5 rounded-full border-2 ${NOTE_STYLES[key].wrap} ${
                          note.colorKey === key ? 'border-[#0B1B34] scale-110' : 'border-white/80 opacity-80 hover:opacity-100'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="mt-2 text-[10px] text-[#8a9bb2]">
        {saving ? 'Saving…' : savedHint || `${notes.length} note${notes.length === 1 ? '' : 's'}`}
      </p>
    </div>
  );
}
