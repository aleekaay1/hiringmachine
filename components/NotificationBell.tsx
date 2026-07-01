import React from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bell, Mail, Phone, PhoneCall, ClipboardList, Megaphone, LifeBuoy, AlertTriangle, X, Trash2 } from 'lucide-react';
import type { AppRole } from '../services/accessControl';
import {
  dismissAllStaffNotifications,
  dismissStaffNotification,
  loadStaffNotifications,
  markStaffNotificationRead,
  NOTIFICATION_CATEGORY_LABELS,
  shouldShowStaffNotificationBell,
  syncStaffNotifications,
  type StaffNotification,
  type StaffNotificationCategory,
} from '../services/notificationService';
import { formatDateTimeCanadaEastern } from '../services/dateDisplay';

type NotificationBellProps = {
  role: AppRole | null;
  userId: string | null;
  roleResolved: boolean;
  className?: string;
  variant?: 'sidebar' | 'topbar';
};

function categoryIcon(category: StaffNotificationCategory) {
  switch (category) {
    case 'email_reply':
      return Mail;
    case 'check_in':
      return ClipboardList;
    case 'low_dials':
      return PhoneCall;
    case 'no_show':
      return AlertTriangle;
    case 'callback':
      return Phone;
    case 'support':
      return LifeBuoy;
    case 'system':
      return Megaphone;
    default:
      return Bell;
  }
}

const NotificationBell: React.FC<NotificationBellProps> = ({
  role,
  userId,
  roleResolved,
  className = '',
  variant = 'sidebar',
}) => {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [clearing, setClearing] = React.useState(false);
  const [dismissingId, setDismissingId] = React.useState<string | null>(null);
  const [notifications, setNotifications] = React.useState<StaffNotification[]>([]);
  const [unread, setUnread] = React.useState(0);
  const [lastFetchedAt, setLastFetchedAt] = React.useState<string | null>(null);
  const [panelStyle, setPanelStyle] = React.useState<React.CSSProperties>({});
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const visible = shouldShowStaffNotificationBell(userId, roleResolved);
  const canFetch = visible;

  const refreshList = React.useCallback(async () => {
    if (!canFetch) return;
    setLoading(true);
    try {
      const result = await loadStaffNotifications();
      setNotifications(result.notifications);
      setUnread(result.unread);
      setLastFetchedAt(new Date().toISOString());
    } catch {
      // silent — bell stays usable
    } finally {
      setLoading(false);
    }
  }, [canFetch]);

  const syncAlerts = React.useCallback(async () => {
    if (!canFetch) return;
    setSyncing(true);
    try {
      const result = await syncStaffNotifications();
      setNotifications(result.notifications);
      setUnread(result.unread);
      setLastFetchedAt(new Date().toISOString());
    } catch {
      // silent — bell stays usable
    } finally {
      setSyncing(false);
    }
  }, [canFetch]);

  const positionPanel = React.useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(384, window.innerWidth - 16);
    const right = Math.max(8, window.innerWidth - rect.right);
    const top = rect.bottom + 8;
    const maxHeight = Math.min(window.innerHeight - top - 12, window.innerHeight * 0.7);
    setPanelStyle({
      position: 'fixed',
      top,
      right,
      width,
      maxHeight,
      zIndex: 200,
    });
  }, []);

  React.useEffect(() => {
    if (!canFetch) return;
    void refreshList();
    const timer = window.setInterval(() => void refreshList(), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [canFetch, refreshList]);

  React.useEffect(() => {
    if (!open) return;
    positionPanel();
    const onResize = () => positionPanel();
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, positionPanel]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!visible) return null;

  const onOpenItem = async (item: StaffNotification) => {
    if (!item.read_at) {
      try {
        await markStaffNotificationRead(item.id);
        setNotifications((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n)),
        );
        setUnread((c) => Math.max(0, c - 1));
      } catch {
        // still navigate
      }
    }
    if (item.link_route) {
      setOpen(false);
      navigate(item.link_route);
    }
  };

  const onDismissItem = async (item: StaffNotification) => {
    setDismissingId(item.id);
    try {
      await dismissStaffNotification(item.id);
      setNotifications((prev) => prev.filter((n) => n.id !== item.id));
      if (!item.read_at) setUnread((c) => Math.max(0, c - 1));
    } catch {
      // keep item visible if dismiss failed
    } finally {
      setDismissingId(null);
    }
  };

  const onClearAll = async () => {
    if (!notifications.length) return;
    setClearing(true);
    try {
      await dismissAllStaffNotifications();
      setNotifications([]);
      setUnread(0);
    } catch {
      // silent
    } finally {
      setClearing(false);
    }
  };

  const buttonClass =
    variant === 'topbar'
      ? 'relative inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#b8d4f0] bg-white text-[#0B1B34] shadow-md ring-1 ring-[#d4e4f7] transition hover:border-[#4e9ae8] hover:bg-[#eef6ff]'
      : 'relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 hover:text-white';

  const statusLine = loading
    ? 'Updating…'
    : unread
      ? `${unread} unread`
      : notifications.length
        ? 'All read'
        : 'All caught up';

  const panel = open ? (
    <div
      ref={panelRef}
      style={panelStyle}
      className="flex flex-col overflow-hidden rounded-2xl border border-[#d4e4f7] bg-white shadow-2xl"
    >
      <div className="border-b border-[#e8f0fa] bg-[#f8fbff] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#0B1B34]">Notifications</p>
            <p className="text-[11px] text-[#5c7594]">{statusLine}</p>
            {lastFetchedAt && (
              <p className="text-[10px] text-[#8aa3c0]">
                Updated {formatDateTimeCanadaEastern(lastFetchedAt)}
              </p>
            )}
          </div>
          {notifications.length > 0 && (
            <button
              type="button"
              onClick={() => void onClearAll()}
              disabled={clearing || loading || syncing}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#d4e4f7] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#c24141] transition hover:bg-[#fff1f1] disabled:opacity-60"
            >
              <Trash2 size={12} />
              {clearing ? 'Clearing…' : 'Clear all'}
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => void refreshList()}
            disabled={loading || syncing || clearing}
            className="rounded-lg px-2 py-1 text-[11px] text-[#4e79a9] hover:bg-[#eef6ff] disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={() => void syncAlerts()}
            disabled={loading || syncing || clearing}
            className="rounded-lg px-2 py-1 text-[11px] text-[#4e79a9] hover:bg-[#eef6ff] disabled:opacity-60"
          >
            {syncing ? 'Syncing…' : 'Sync alerts'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[#5c7594]">No notifications right now.</p>
        ) : (
          notifications.map((item) => {
            const Icon = categoryIcon(item.category);
            const unreadItem = !item.read_at;
            const dismissing = dismissingId === item.id;
            return (
              <div
                key={item.id}
                className={`flex items-start gap-2 border-b border-[#f0f4fa] px-3 py-3 transition hover:bg-[#f8fbff] ${
                  unreadItem ? 'bg-[#eef6ff]/60' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => void onOpenItem(item)}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                >
                  <span
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                      unreadItem ? 'bg-[#0B1B34] text-white' : 'bg-[#eef6ff] text-[#4e79a9]'
                    }`}
                  >
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-[#0B1B34]">{item.title}</span>
                      <span className="rounded-full bg-[#eef6ff] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#4e79a9]">
                        {NOTIFICATION_CATEGORY_LABELS[item.category] || item.category}
                      </span>
                    </span>
                    {item.body && (
                      <span className="mt-1 block text-xs leading-relaxed text-[#5c7594]">{item.body}</span>
                    )}
                    <span className="mt-1 block text-[10px] text-[#8aa3c0]">
                      {formatDateTimeCanadaEastern(item.created_at)}
                      {item.link_label ? ` · ${item.link_label}` : ''}
                    </span>
                  </span>
                  {unreadItem && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-rose-500" />}
                </button>
                <button
                  type="button"
                  onClick={() => void onDismissItem(item)}
                  disabled={dismissing || clearing}
                  aria-label={`Dismiss ${item.title}`}
                  title="Dismiss"
                  className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8aa3c0] transition hover:bg-[#fff1f1] hover:text-[#c24141] disabled:opacity-50"
                >
                  <X size={16} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          const nextOpen = !open;
          setOpen(nextOpen);
          if (nextOpen) {
            positionPanel();
            void refreshList();
          }
        }}
        className={buttonClass}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        title="Notifications"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {typeof document !== 'undefined' && panel ? createPortal(panel, document.body) : null}
    </div>
  );
};

export default NotificationBell;
