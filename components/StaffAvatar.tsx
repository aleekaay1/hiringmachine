import React from 'react';
import { profileInitials } from '../services/webinarGeekRecruiterAnalytics';
import { resolveStaffAvatarUrl, type StaffAvatarLookup } from '../services/staffAvatarLookup';

export type StaffAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<StaffAvatarSize, string> = {
  xs: 'h-7 w-7 text-[10px]',
  sm: 'h-9 w-9 text-[11px]',
  md: 'h-11 w-11 text-sm',
  lg: 'h-16 w-16 text-base',
  xl: 'h-20 w-20 text-xl',
};

type StaffAvatarProps = {
  name: string;
  userId?: string | null;
  avatarUrl?: string | null;
  lookup?: StaffAvatarLookup;
  size?: StaffAvatarSize;
  className?: string;
  ringClassName?: string;
  active?: boolean;
  title?: string;
};

const StaffAvatar: React.FC<StaffAvatarProps> = ({
  name,
  userId,
  avatarUrl,
  lookup,
  size = 'sm',
  className = '',
  ringClassName = '',
  active = false,
  title,
}) => {
  const resolvedUrl = resolveStaffAvatarUrl(lookup, { userId, displayName: name, avatarUrl });
  const initials = profileInitials(name);
  const sizeClass = SIZE_CLASS[size];
  const activeRing = active ? 'ring-2 ring-[#005EB8]' : '';

  if (resolvedUrl) {
    return (
      <span
        className={`relative inline-flex shrink-0 overflow-hidden rounded-full ${sizeClass} ${activeRing} ${ringClassName} ${className}`}
        title={title || name}
      >
        <img src={resolvedUrl} alt="" className="h-full w-full object-cover" />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${sizeClass} ${
        active ? 'bg-[#005EB8] text-white' : 'bg-slate-200 text-slate-700'
      } ${ringClassName} ${className}`}
      title={title || name}
      style={{ fontFamily: 'Outfit, Inter, system-ui, sans-serif' }}
    >
      {initials}
    </span>
  );
};

export default StaffAvatar;
