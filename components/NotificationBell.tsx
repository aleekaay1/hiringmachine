import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Mail, Phone, PhoneCall, ClipboardList, Megaphone, LifeBuoy, AlertTriangle } from 'lucide-react';
import type { AppRole } from '../services/accessControl';
import {
  canUseStaffNotifications,
  loadStaffNotifications,
  markAllStaffNotificationsRead,
  markStaffNotificationRead,
  NOTIFICATION_CATEGORY_LABELS,
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
  const [notifications, setNotifications] = React.useState<StaffNotification[]>([]);
  const [unread, setUnread] = React.useState(0);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const enabled = roleResolved && Boolean(userId) && canUseStaffNotifications(role);

  const refresh = React.useCallback(async (sync = false) => {
    if (!enabled) return;
    setLoading(true);
    try {
      const result = sync ? await syncStaffNotifications() : await loadStaffNotifications();
      setNotifications(result.notifications);
      setUnread(result.unread);
    } catch {
      // silent — bell stays usable
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  React.useEffect(() => {
    if (!enabled) return;
    void refresh(false);
    const timer = window.setInterval(() => void refresh(true), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!enabled) return null;

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

  const buttonClass =
    variant === 'topbar'
      ? 'relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#d4e4f7] bg-[#f8fbff] text-[#0B1B34] transition hover:border-[#b8d4f0] hover:bg-[#eef6ff]'
      : 'relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 hover:text-white';

  return (
    <div ref={panelRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void refresh(true);
        }}
        className={buttonClass}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        title="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[80] mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[#d4e4f7] bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#e8f0fa] bg-[#f8fbff] px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-[#0B1B34]">Notifications</p>
              <p className="text-[11px] text-[#5c7594]">
                {loading ? 'Updating…' : unread ? `${unread} unread` : 'All caught up'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void refresh(true)}
                className="rounded-lg px-2 py-1 text-[11px] text-[#4e79a9] hover:bg-[#eef6ff]"
              >
                Refresh
              </button>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    void markAllStaffNotificationsRead().then(() => refresh(false));
                  }}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-[#4e79a9] hover:bg-[#eef6ff]"
                >
                  <CheckCheck size={12} />
                  Mark all
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[min(24rem,60vh)] overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[#5c7594]">No notifications right now.</p>
            ) : (
              notifications.map((item) => {
                const Icon = categoryIcon(item.category);
                const unreadItem = !item.read_at;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void onOpenItem(item)}
                    className={`flex w-full items-start gap-3 border-b border-[#f0f4fa] px-4 py-3 text-left transition hover:bg-[#f8fbff] ${
                      unreadItem ? 'bg-[#eef6ff]/60' : ''
                    }`}
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
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
